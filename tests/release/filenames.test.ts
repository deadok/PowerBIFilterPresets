import { describe, expect, it } from "vitest";

import { getReleaseArtifactFileNames } from "../../scripts/release/filenames";

describe("getReleaseArtifactFileNames", () => {
  it("builds the required artifact names", () => {
    expect(getReleaseArtifactFileNames("0.2.0")).toEqual({
      zipFileName: "power-bi-filter-presets-0.2.0.zip",
      crxFileName: "power-bi-filter-presets-0.2.0.crx",
      checksumsFileName: "SHA256SUMS.txt"
    });
  });
});
