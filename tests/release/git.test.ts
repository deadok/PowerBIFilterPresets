import { describe, expect, it, vi } from "vitest";

import { isCommitReachableFromRef } from "../../scripts/release/git";

describe("isCommitReachableFromRef", () => {
  it("returns true when git reports the commit is reachable", async () => {
    const execFile = vi.fn().mockResolvedValue({ exitCode: 0, stderr: "" });

    await expect(
      isCommitReachableFromRef({
        commitish: "abc123",
        refName: "origin/main",
        execFile
      })
    ).resolves.toBe(true);
  });

  it("returns false when git reports the commit is not reachable", async () => {
    const execFile = vi.fn().mockResolvedValue({ exitCode: 1, stderr: "" });

    await expect(
      isCommitReachableFromRef({
        commitish: "abc123",
        refName: "origin/main",
        execFile
      })
    ).resolves.toBe(false);
  });

  it("surfaces unexpected git failures", async () => {
    const execFile = vi.fn().mockResolvedValue({ exitCode: 2, stderr: "fatal: bad ref" });

    await expect(
      isCommitReachableFromRef({
        commitish: "abc123",
        refName: "origin/main",
        execFile
      })
    ).rejects.toThrow(/bad ref/i);
  });
});
