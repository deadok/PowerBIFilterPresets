import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExtensionForTest, type TestBuild } from "./buildExtension";

describe("content script bundle", () => {
  let testBuild: TestBuild;

  beforeAll(async () => {
    testBuild = await buildExtensionForTest();
  });

  afterAll(() => {
    testBuild?.cleanup();
  });

  it("uses isolated output generated for the current test run", () => {
    expect(testBuild.outDir).not.toBe(resolve(process.cwd(), "dist"));
  });

  it("is self-contained for Chrome content-script loading", () => {
    const bundle = readFileSync(join(testBuild.outDir, "assets/contentScript.js"), "utf8");

    expect(bundle).not.toMatch(/^\s*import(?:\s|\{)/m);
  });
});
