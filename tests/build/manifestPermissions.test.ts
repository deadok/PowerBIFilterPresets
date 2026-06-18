import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExtensionForTest, type TestBuild } from "./buildExtension";

type ExtensionManifest = {
  permissions?: string[];
};

const expectedPermissions = ["storage", "activeTab", "scripting", "clipboardRead"];

describe("extension manifest permissions", () => {
  let testBuild: TestBuild;

  beforeAll(async () => {
    testBuild = await buildExtensionForTest();
  });

  afterAll(() => {
    testBuild?.cleanup();
  });

  it("declares only the required extension permissions in the source manifest", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "manifest.json"), "utf8")
    ) as ExtensionManifest;

    expect(manifest.permissions).toEqual(expectedPermissions);
  });

  it("copies the required extension permissions into the built manifest", () => {
    const manifest = JSON.parse(
      readFileSync(join(testBuild.outDir, "manifest.json"), "utf8")
    ) as ExtensionManifest;

    expect(manifest.permissions).toEqual(expectedPermissions);
  });
});
