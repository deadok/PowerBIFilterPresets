import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertVersionConsistency, readVersionFromJsonFile } from "../../scripts/release/versions";

const tempDirs: string[] = [];

function writeJson(tempDir: string, fileName: string, value: unknown): string {
  const filePath = join(tempDir, fileName);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

describe("release version validation", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("accepts exact matching tag, package, source manifest, and built manifest versions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-version-"));
    tempDirs.push(tempDir);
    const packageJsonPath = writeJson(tempDir, "package.json", { version: "0.2.0" });
    const manifestJsonPath = writeJson(tempDir, "manifest.json", { version: "0.2.0" });
    const distDir = join(tempDir, "dist");
    mkdirSync(distDir);
    const builtManifestPath = writeJson(distDir, "manifest.json", { version: "0.2.0" });

    expect(
      assertVersionConsistency({
        tagVersion: "0.2.0",
        packageJsonPath,
        manifestJsonPath,
        builtManifestPath
      })
    ).toEqual({
      tagVersion: "0.2.0",
      packageVersion: "0.2.0",
      manifestVersion: "0.2.0",
      builtManifestVersion: "0.2.0"
    });
  });

  it("rejects package version mismatches", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-version-"));
    tempDirs.push(tempDir);
    const distDir = join(tempDir, "dist");
    mkdirSync(distDir);

    expect(() =>
      assertVersionConsistency({
        tagVersion: "0.2.0",
        packageJsonPath: writeJson(tempDir, "package.json", { version: "0.1.9" }),
        manifestJsonPath: writeJson(tempDir, "manifest.json", { version: "0.2.0" }),
        builtManifestPath: writeJson(distDir, "manifest.json", { version: "0.2.0" })
      })
    ).toThrow(/package\.json/i);
  });

  it("rejects source manifest mismatches", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-version-"));
    tempDirs.push(tempDir);
    const distDir = join(tempDir, "dist");
    mkdirSync(distDir);

    expect(() =>
      assertVersionConsistency({
        tagVersion: "0.2.0",
        packageJsonPath: writeJson(tempDir, "package.json", { version: "0.2.0" }),
        manifestJsonPath: writeJson(tempDir, "manifest.json", { version: "0.1.9" }),
        builtManifestPath: writeJson(distDir, "manifest.json", { version: "0.2.0" })
      })
    ).toThrow(/manifest\.json/i);
  });

  it("rejects built manifest mismatches", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-version-"));
    tempDirs.push(tempDir);
    const distDir = join(tempDir, "dist");
    mkdirSync(distDir);

    expect(() =>
      assertVersionConsistency({
        tagVersion: "0.2.0",
        packageJsonPath: writeJson(tempDir, "package.json", { version: "0.2.0" }),
        manifestJsonPath: writeJson(tempDir, "manifest.json", { version: "0.2.0" }),
        builtManifestPath: writeJson(distDir, "manifest.json", { version: "0.2.1" })
      })
    ).toThrow(/dist\/manifest\.json/i);
  });

  it("rejects malformed json", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-version-"));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, "package.json");
    writeFileSync(filePath, "{ not valid json");

    expect(() => readVersionFromJsonFile(filePath, "package.json")).toThrow(/json/i);
  });

  it("rejects missing version fields", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-version-"));
    tempDirs.push(tempDir);
    const filePath = writeJson(tempDir, "manifest.json", { name: "x" });

    expect(() => readVersionFromJsonFile(filePath, "manifest.json")).toThrow(/version/i);
  });
});
