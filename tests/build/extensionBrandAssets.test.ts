import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExtensionForTest, type TestBuild } from "./buildExtension";

type ExtensionManifest = {
  icons?: Record<string, string>;
  action?: {
    default_icon?: Record<string, string>;
  };
};

const expectedIcons = {
  "16": "assets/brand/icon-16.png",
  "32": "assets/brand/icon-32.png",
  "48": "assets/brand/icon-48.png",
  "128": "assets/brand/icon-128.png"
};

describe("extension brand assets", () => {
  let testBuild: TestBuild;

  beforeAll(async () => {
    testBuild = await buildExtensionForTest();
  });

  afterAll(() => {
    testBuild?.cleanup();
  });

  it("declares the complete icon set for the extension and toolbar action", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "manifest.json"), "utf8")
    ) as ExtensionManifest;

    expect(manifest.icons).toEqual(expectedIcons);
    expect(manifest.action?.default_icon).toEqual(expectedIcons);
  });

  it("keeps every declared icon and popup logo in Vite's public assets", () => {
    for (const assetPath of [...Object.values(expectedIcons), "assets/brand/logo.png"]) {
      expect(existsSync(resolve(process.cwd(), "public", assetPath)), assetPath).toBe(true);
    }
  });

  it("emits a manifest whose brand asset references exist in the current build output", () => {
    const manifest = JSON.parse(
      readFileSync(join(testBuild.outDir, "manifest.json"), "utf8")
    ) as ExtensionManifest;
    const assetPaths = [
      ...Object.values(manifest.icons ?? {}),
      ...Object.values(manifest.action?.default_icon ?? {}),
      "assets/brand/logo.png"
    ];

    expect(manifest.icons).toEqual(expectedIcons);
    expect(manifest.action?.default_icon).toEqual(expectedIcons);
    for (const assetPath of new Set(assetPaths)) {
      expect(existsSync(join(testBuild.outDir, assetPath)), assetPath).toBe(true);
    }
  });
});
