import { describe, expect, it } from "vitest";

import { parseStableReleaseTag } from "../../scripts/release/tag";

describe("parseStableReleaseTag", () => {
  it("accepts stable semantic version tags", () => {
    expect(parseStableReleaseTag("v0.2.0")).toBe("0.2.0");
    expect(parseStableReleaseTag("v12.34.56")).toBe("12.34.56");
  });

  it("rejects malformed or prerelease tags", () => {
    for (const value of ["0.2.0", "v0.2", "v0.2.0-beta.1", "release-v0.2.0", "v1.0.0+meta"]) {
      expect(() => parseStableReleaseTag(value)).toThrow(/stable release tag/i);
    }
  });
});
