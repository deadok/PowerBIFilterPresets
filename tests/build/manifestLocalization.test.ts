import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExtensionForTest, type TestBuild } from "./buildExtension";

type ExtensionManifest = {
  name: string;
  description: string;
  default_locale?: string;
  action?: {
    default_title?: string;
  };
};

describe("extension manifest localization", () => {
  let testBuild: TestBuild;

  beforeAll(async () => {
    testBuild = await buildExtensionForTest();
  });

  afterAll(() => {
    testBuild?.cleanup();
  });

  function expectLocalizedManifestStrings(manifest: ExtensionManifest) {
    expect(manifest.name).toBe("__MSG_extensionName__");
    expect(manifest.description).toBe("__MSG_extensionDescription__");
    expect(manifest.default_locale).toBe("en");
    expect(manifest.action?.default_title).toBe("__MSG_actionDefaultTitle__");
  }

  it("declares manifest-facing strings through Chrome i18n message references in the source manifest", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "manifest.json"), "utf8")
    ) as ExtensionManifest;

    expectLocalizedManifestStrings(manifest);
  });

  it("preserves manifest-facing Chrome i18n message references in the built manifest", () => {
    const manifest = JSON.parse(
      readFileSync(join(testBuild.outDir, "manifest.json"), "utf8")
    ) as ExtensionManifest;

    expectLocalizedManifestStrings(manifest);
  });

  it("emits the English locale catalog into the build output", () => {
    expect(existsSync(join(testBuild.outDir, "_locales", "en", "messages.json"))).toBe(true);
  });
});
