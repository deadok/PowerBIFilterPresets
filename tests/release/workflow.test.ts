import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("release workflow", () => {
  it("limits permissions and triggers to pushed stable tags", () => {
    const workflow = parse(
      readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8")
    ) as Record<string, any>;

    expect(workflow.permissions).toEqual({ contents: "write" });
    expect(workflow.on.push.tags).toEqual(["v*.*.*"]);
    expect(workflow.on.pull_request_target).toBeUndefined();
  });

  it("uses tag keyed concurrency and unconditional key cleanup", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8");

    expect(workflow).toMatch(/concurrency:/);
    expect(workflow).toMatch(/github\.ref_name/);
    expect(workflow).toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/);
    expect(workflow).toMatch(/CRX_PRIVATE_KEY_BASE64/);
  });
});
