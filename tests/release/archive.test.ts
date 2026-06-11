import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  collectManifestAssetPaths,
  createExtensionZip,
  inspectZipArchive,
  validateBuiltManifestAssets
} from "../../scripts/release/archive";

const tempDirs: string[] = [];

function createDistFixture(): { distDir: string; zipPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "release-archive-"));
  tempDirs.push(tempDir);
  const distDir = join(tempDir, "dist");
  mkdirSync(join(distDir, "assets", "brand"), { recursive: true });
  writeFileSync(
    join(distDir, "manifest.json"),
    JSON.stringify(
      {
        manifest_version: 3,
        version: "0.2.0",
        icons: { "16": "assets/brand/icon-16.png" },
        action: {
          default_popup: "index.html",
          default_icon: { "16": "assets/brand/icon-16.png" }
        },
        content_scripts: [{ matches: ["<all_urls>"], js: ["assets/contentScript.js"] }]
      },
      null,
      2
    )
  );
  writeFileSync(join(distDir, "index.html"), "<html></html>");
  writeFileSync(join(distDir, "assets", "contentScript.js"), "console.log('x');");
  writeFileSync(join(distDir, "assets", "brand", "icon-16.png"), "png");
  writeFileSync(join(distDir, ".DS_Store"), "ignore");
  return { distDir, zipPath: join(tempDir, "extension.zip") };
}

describe("release archive helpers", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collects referenced manifest assets", () => {
    const assetPaths = collectManifestAssetPaths({
      icons: { "16": "assets/brand/icon-16.png" },
      action: { default_popup: "index.html", default_icon: { "16": "assets/brand/icon-16.png" } },
      content_scripts: [{ js: ["assets/contentScript.js"] }]
    });

    expect(assetPaths).toEqual([
      "assets/brand/icon-16.png",
      "index.html",
      "assets/contentScript.js"
    ]);
  });

  it("rejects missing built manifest assets", () => {
    const { distDir } = createDistFixture();

    expect(() => validateBuiltManifestAssets(distDir)).not.toThrow();
    expect(() =>
      validateBuiltManifestAssets(join(distDir, "missing"))
    ).toThrow();
  });

  it("creates a zip with manifest.json at the archive root and no dist/ wrapper", async () => {
    const { distDir, zipPath } = createDistFixture();

    await createExtensionZip({ sourceDir: distDir, outputPath: zipPath });

    const archive = await inspectZipArchive(zipPath);
    expect(archive.entries).toContain("manifest.json");
    expect(archive.entries).toContain("index.html");
    expect(archive.entries).not.toContain("dist/manifest.json");
    expect(archive.entries).not.toContain(".DS_Store");
    expect(archive.manifestVersion).toBe("0.2.0");
  });
});
