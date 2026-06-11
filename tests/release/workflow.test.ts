import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("release workflow", () => {
  it("uses a low-privilege tag candidate workflow for pushed stable tags", () => {
    const workflow = parse(
      readFileSync(resolve(process.cwd(), ".github/workflows/release-candidate.yml"), "utf8")
    ) as Record<string, any>;

    expect(workflow.permissions).toEqual({});
    expect(workflow.on.push.tags).toEqual(["v*.*.*"]);
    expect(workflow.on.pull_request_target).toBeUndefined();
  });

  it("runs the privileged release from trusted workflow_run code", () => {
    const workflow = parse(
      readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8")
    ) as Record<string, any>;

    expect(workflow.permissions).toEqual({ contents: "write" });
    expect(workflow.on.workflow_run.workflows).toEqual(["Release Tag Candidate"]);
    expect(workflow.on.workflow_run.types).toEqual(["completed"]);
    expect(workflow.jobs.build.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.publish.permissions).toEqual({ contents: "write" });
    expect(workflow.on.pull_request_target).toBeUndefined();
  });

  it("uses tag keyed concurrency, isolates signing, and keeps unconditional key cleanup", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8");

    expect(workflow).toMatch(/concurrency:/);
    expect(workflow).toMatch(/github\.event\.workflow_run\.head_sha/);
    expect(workflow).toMatch(/needs:\s*\n\s*-\s*build/i);
    expect(workflow).toMatch(/upload-artifact/i);
    expect(workflow).toMatch(/download-artifact/i);
    expect(workflow).toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/);
    expect(workflow).toMatch(/CRX_PRIVATE_KEY_BASE64/);
  });
});
