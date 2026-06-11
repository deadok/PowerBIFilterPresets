import { readJsonFile, expectObjectRecord } from "./json.ts";

export type VersionConsistencyResult = {
  tagVersion: string;
  packageVersion: string;
  manifestVersion: string;
  builtManifestVersion?: string;
};

export function readVersionFromJsonFile(path: string, label: string): string {
  const value = expectObjectRecord(readJsonFile(path, label), label);
  const version = value.version;

  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Missing string version field in ${label} at ${path}.`);
  }

  return version;
}

export function assertVersionConsistency(input: {
  tagVersion: string;
  packageJsonPath: string;
  manifestJsonPath: string;
  builtManifestPath?: string;
}): VersionConsistencyResult {
  const packageVersion = readVersionFromJsonFile(input.packageJsonPath, "package.json");
  const manifestVersion = readVersionFromJsonFile(input.manifestJsonPath, "manifest.json");
  const builtManifestVersion = input.builtManifestPath
    ? readVersionFromJsonFile(input.builtManifestPath, "dist/manifest.json")
    : undefined;

  const details = {
    tagVersion: input.tagVersion,
    packageVersion,
    manifestVersion,
    builtManifestVersion
  };

  if (packageVersion !== input.tagVersion) {
    throw new Error(formatMismatch("package.json", details));
  }

  if (manifestVersion !== input.tagVersion) {
    throw new Error(formatMismatch("manifest.json", details));
  }

  if (builtManifestVersion !== undefined && builtManifestVersion !== input.tagVersion) {
    throw new Error(formatMismatch("dist/manifest.json", details));
  }

  return details;
}

function formatMismatch(label: string, details: VersionConsistencyResult): string {
  return [
    `Release version mismatch for ${label}.`,
    `tag version: ${details.tagVersion}`,
    `package.json version: ${details.packageVersion}`,
    `manifest.json version: ${details.manifestVersion}`,
    `dist/manifest.json version: ${details.builtManifestVersion ?? "(not checked)"}`
  ].join("\n");
}
