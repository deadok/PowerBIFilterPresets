import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import yauzl from "yauzl";
import yazl from "yazl";

import { expectObjectRecord, readJsonFile } from "./json.ts";
import { readVersionFromJsonFile } from "./versions.ts";

type ManifestRecord = Record<string, unknown>;

const FIXED_ZIP_MTIME = new Date("1980-01-01T00:00:00.000Z");

export function collectManifestAssetPaths(manifest: ManifestRecord): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value === "string" && value.length > 0 && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  };

  const addRecordValues = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    for (const item of Object.values(value)) {
      add(item);
    }
  };

  addRecordValues(manifest.icons);

  const action = manifest.action;
  if (action && typeof action === "object" && !Array.isArray(action)) {
    const actionRecord = action as Record<string, unknown>;
    add(actionRecord.default_popup);
    addRecordValues(actionRecord.default_icon);
  }

  const contentScripts = manifest.content_scripts;
  if (Array.isArray(contentScripts)) {
    for (const script of contentScripts) {
      if (!script || typeof script !== "object" || Array.isArray(script)) {
        continue;
      }
      const record = script as Record<string, unknown>;
      for (const field of ["js", "css"] as const) {
        const values = record[field];
        if (Array.isArray(values)) {
          for (const value of values) {
            add(value);
          }
        }
      }
    }
  }

  const webAccessibleResources = manifest.web_accessible_resources;
  if (Array.isArray(webAccessibleResources)) {
    for (const resource of webAccessibleResources) {
      if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
        continue;
      }
      const resources = (resource as Record<string, unknown>).resources;
      if (Array.isArray(resources)) {
        for (const value of resources) {
          add(value);
        }
      }
    }
  }

  for (const field of ["background", "options_page", "options_ui", "devtools_page", "side_panel"] as const) {
    const value = manifest[field];
    if (typeof value === "string") {
      add(value);
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      add(record.page);
      add(record.service_worker);
    }
  }

  return result;
}

export function validateBuiltManifestAssets(distDir: string): {
  manifestPath: string;
  manifestVersion: string;
  assetPaths: string[];
} {
  const manifestPath = resolve(distDir, "manifest.json");
  const manifestVersion = readVersionFromJsonFile(manifestPath, "dist/manifest.json");
  const manifest = expectObjectRecord(readJsonFile(manifestPath, "dist/manifest.json"), "dist/manifest.json");
  const assetPaths = collectManifestAssetPaths(manifest);

  for (const assetPath of assetPaths) {
    const resolvedPath = resolve(distDir, assetPath);
    if (!resolvedPath.startsWith(resolve(distDir))) {
      throw new Error(`Manifest asset path escapes dist/: ${assetPath}`);
    }
    if (!existsSync(resolvedPath)) {
      throw new Error(`Built manifest references missing asset: ${assetPath}`);
    }
  }

  return { manifestPath, manifestVersion, assetPaths };
}

export async function createExtensionZip(input: { sourceDir: string; outputPath: string }): Promise<void> {
  const sourceDir = resolve(input.sourceDir);
  const outputPath = resolve(input.outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });

  const zipFile = new yazl.ZipFile();
  const entries = listFilesRecursively(sourceDir);

  for (const entry of entries) {
    const archivePath = relative(sourceDir, entry).replaceAll("\\", "/");
    if (shouldSkipArchiveEntry(archivePath)) {
      continue;
    }

    zipFile.addFile(entry, archivePath, {
      mtime: FIXED_ZIP_MTIME,
      mode: statSync(entry).mode
    });
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(outputPath);
    output.on("close", resolvePromise);
    output.on("error", rejectPromise);
    zipFile.outputStream.on("error", rejectPromise).pipe(output);
    zipFile.end();
  });
}

export async function inspectZipArchive(zipPath: string): Promise<{
  entries: string[];
  manifestVersion: string;
}> {
  const entries: string[] = [];
  let manifestVersion: string | undefined;

  const zipFile = await openZipFile(zipPath);
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        entries.push(entry.fileName);
        if (entry.fileName === "manifest.json") {
          zipFile.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              rejectPromise(error ?? new Error("Unable to read manifest.json from ZIP."));
              return;
            }

            const chunks: Buffer[] = [];
            stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            stream.on("end", () => {
              const manifest = expectObjectRecord(
                JSON.parse(Buffer.concat(chunks).toString("utf8")),
                "ZIP manifest.json"
              );
              const version = manifest.version;
              if (typeof version !== "string" || version.length === 0) {
                rejectPromise(new Error("ZIP manifest.json is missing a string version field."));
                return;
              }
              manifestVersion = version;
              zipFile.readEntry();
            });
            stream.on("error", rejectPromise);
          });
          return;
        }

        zipFile.readEntry();
      });
      zipFile.on("end", resolvePromise);
      zipFile.on("error", rejectPromise);
    });
  } finally {
    zipFile.close();
  }

  if (!entries.includes("manifest.json")) {
    throw new Error("ZIP archive is missing manifest.json at the archive root.");
  }

  if (!manifestVersion) {
    throw new Error("Unable to read manifest.json version from ZIP archive.");
  }

  return { entries, manifestVersion };
}

function listFilesRecursively(rootDir: string): string[] {
  const results: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const directoryEntries = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    );

    for (const entry of directoryEntries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipArchiveEntry(relative(rootDir, fullPath).replaceAll("\\", "/"))) {
          queue.push(fullPath);
        }
        continue;
      }

      if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function shouldSkipArchiveEntry(entryPath: string): boolean {
  return (
    entryPath.length === 0 ||
    entryPath === ".DS_Store" ||
    entryPath.startsWith("__MACOSX/") ||
    entryPath.endsWith("/.DS_Store") ||
    entryPath.endsWith(".pem") ||
    entryPath.endsWith(".key") ||
    entryPath.endsWith(".crx") ||
    entryPath.endsWith(".zip") ||
    entryPath.endsWith("~")
  );
}

function openZipFile(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        rejectPromise(error ?? new Error(`Unable to open ZIP archive: ${zipPath}`));
        return;
      }
      resolvePromise(zipFile);
    });
  });
}

export async function removePathIfPresent(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}
