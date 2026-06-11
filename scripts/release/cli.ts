import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { createExtensionZip, inspectZipArchive, validateBuiltManifestAssets } from "./archive.ts";
import { generateSha256SumsFile, verifySha256SumsFile } from "./checksums.ts";
import { getExtensionIdFromPrivateKeyFile, buildCrxFromZip, validateCrx3File, validatePrivateKeyFile, withDecodedPrivateKeyFile } from "./crx.ts";
import { getReleaseArtifactFileNames } from "./filenames.ts";
import { isCommitReachableFromRef } from "./git.ts";
import { parseStableReleaseTag } from "./tag.ts";
import { assertVersionConsistency } from "./versions.ts";

type CommandHandler = (args: Map<string, string | boolean>) => Promise<void>;

const commands: Record<string, CommandHandler> = {
  "check-tag": async (args) => {
    const tag = requireValue(args, "tag");
    writeJsonToStdout({ tag, version: parseStableReleaseTag(tag) });
  },
  "verify-source": async (args) => {
    const tag = requireValue(args, "tag");
    const version = parseStableReleaseTag(tag);
    const packageJsonPath = resolveValue(args, "package", "package.json");
    const manifestJsonPath = resolveValue(args, "manifest", "manifest.json");

    const versions = assertVersionConsistency({
      tagVersion: version,
      packageJsonPath,
      manifestJsonPath
    });

    if (args.get("require-reachability") === true) {
      const commitish = requireValue(args, "commit");
      const refName = getStringValue(args, "main-ref") ?? "origin/main";
      const reachable = await isCommitReachableFromRef({ commitish, refName });
      if (!reachable) {
        throw new Error(`Tagged commit ${commitish} is not reachable from ${refName}.`);
      }
    }

    writeJsonToStdout({ ...versions, reachableFromMain: args.get("require-reachability") === true });
  },
  "verify-built": async (args) => {
    const tag = requireValue(args, "tag");
    const version = parseStableReleaseTag(tag);
    const distDir = resolveValue(args, "dist", "dist");
    const packageJsonPath = resolveValue(args, "package", "package.json");
    const manifestJsonPath = resolveValue(args, "manifest", "manifest.json");
    const builtManifestPath = join(distDir, "manifest.json");

    const versions = assertVersionConsistency({
      tagVersion: version,
      packageJsonPath,
      manifestJsonPath,
      builtManifestPath
    });
    const assets = validateBuiltManifestAssets(distDir);

    writeJsonToStdout({ ...versions, assetPaths: assets.assetPaths });
  },
  "build-zip": async (args) => {
    const version = requireValue(args, "version");
    const distDir = resolveValue(args, "dist", "dist");
    const outDir = resolveValue(args, "out-dir", ".release");
    const outputPath = join(outDir, getReleaseArtifactFileNames(version).zipFileName);

    validateBuiltManifestAssets(distDir);
    await createExtensionZip({ sourceDir: distDir, outputPath });
    const archive = await inspectZipArchive(outputPath);
    if (archive.manifestVersion !== version) {
      throw new Error(`ZIP manifest version mismatch: expected ${version}, received ${archive.manifestVersion}.`);
    }

    writeJsonToStdout({ outputPath, entries: archive.entries });
  },
  "write-key": async (args) => {
    const envName = getStringValue(args, "env") ?? "CRX_PRIVATE_KEY_BASE64";
    const outputPath = resolveValue(args, "output", join(".release", "crx-signing-key.pem"));
    const secretValue = process.env[envName] ?? "";
    const tempDir = await mkdtemp(join(tmpdir(), "release-key-"));

    await withDecodedPrivateKeyFile(secretValue, tempDir, async (tempKeyPath) => {
      mkdirSync(dirname(outputPath), { recursive: true });
      const fileBuffer = await readFile(tempKeyPath);
      writeFileSync(outputPath, fileBuffer, { mode: 0o600 });
      validatePrivateKeyFile(outputPath);
    });

    writeJsonToStdout({ outputPath });
  },
  "sign-crx": async (args) => {
    const zipPath = resolveValue(args, "zip", join(".release", "extension.zip"));
    const keyPath = resolveValue(args, "key", join(".release", "crx-signing-key.pem"));
    const version = requireValue(args, "version");
    const outDir = resolveValue(args, "out-dir", ".release");
    const outputPath = join(outDir, getReleaseArtifactFileNames(version).crxFileName);

    validatePrivateKeyFile(keyPath);
    await buildCrxFromZip({ zipPath, keyPath, outputPath });
    writeJsonToStdout({ outputPath, ...validateCrx3File(outputPath) });
  },
  "generate-checksums": async (args) => {
    const zipPath = resolveValue(args, "zip", join(".release", "extension.zip"));
    const crxPath = resolveValue(args, "crx", join(".release", "extension.crx"));
    const outputPath = resolveValue(args, "output", join(dirname(zipPath), "SHA256SUMS.txt"));

    const fileNames = await generateSha256SumsFile([zipPath, crxPath], outputPath);
    writeJsonToStdout({ outputPath, fileNames });
  },
  "verify-checksums": async (args) => {
    const filePath = resolveValue(args, "file", join(".release", "SHA256SUMS.txt"));
    const fileNames = await verifySha256SumsFile(filePath, getStringValue(args, "base-dir"));
    writeJsonToStdout({ fileNames });
  },
  "inspect": async (args) => {
    const zipPath = resolveValue(args, "zip", join(".release", "extension.zip"));
    const output: Record<string, unknown> = {
      zip: await inspectZipArchive(zipPath)
    };

    const crxPath = getStringValue(args, "crx");
    if (crxPath) {
      output.crx = validateCrx3File(resolve(crxPath));
    }

    const checksumsPath = getStringValue(args, "checksums");
    if (checksumsPath) {
      output.checksums = await verifySha256SumsFile(resolve(checksumsPath), dirname(resolve(checksumsPath)));
    }

    writeJsonToStdout(output);
  },
  "extension-id": async (args) => {
    const keyPath = resolveValue(args, "key", join(".release", "crx-signing-key.pem"));
    writeJsonToStdout({ extensionId: getExtensionIdFromPrivateKeyFile(keyPath) });
  }
};

await main(process.argv.slice(2));

async function main(argv: string[]): Promise<void> {
  const [commandName, ...rest] = argv;
  if (!commandName || !(commandName in commands)) {
    throw new Error(`Unknown release command: ${commandName ?? "(missing)"}`);
  }

  const args = parseArguments(rest);
  await commands[commandName](args);
}

function parseArguments(argv: string[]): Map<string, string | boolean> {
  const values = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected argument: ${value}`);
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
      continue;
    }
    values.set(key, next);
    index += 1;
  }
  return values;
}

function getStringValue(args: Map<string, string | boolean>, key: string): string | undefined {
  const value = args.get(key);
  return typeof value === "string" ? value : undefined;
}

function resolveValue(args: Map<string, string | boolean>, key: string, fallback: string): string {
  return resolve(getStringValue(args, key) ?? fallback);
}

function requireValue(args: Map<string, string | boolean>, key: string): string {
  const value = getStringValue(args, key);
  if (!value) {
    throw new Error(`Missing required --${key} argument.`);
  }
  return value;
}

function writeJsonToStdout(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
