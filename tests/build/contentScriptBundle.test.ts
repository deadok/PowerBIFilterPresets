import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("content script bundle", () => {
  it("is self-contained for Chrome content-script loading", () => {
    const bundle = readFileSync(resolve(process.cwd(), "dist/assets/contentScript.js"), "utf8");

    expect(bundle).not.toMatch(/^\s*import(?:\s|\{)/m);
  });
});
