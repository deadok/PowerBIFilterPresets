import { describe, expect, it } from "vitest";
import { selectBestFrameForFilters } from "../../src/popup/frameTarget";

describe("selectBestFrameForFilters", () => {
  it("selects the frame with supported filters", () => {
    expect(
      selectBestFrameForFilters([
        { frameId: 0, href: "https://portal.example/report", title: "Portal", supportedFilterCount: 0 },
        { frameId: 7, href: "https://portal.example/powerbi", title: "Power BI", supportedFilterCount: 12 }
      ])
    ).toBe(7);
  });

  it("uses the frame with the highest number of supported filters", () => {
    expect(
      selectBestFrameForFilters([
        { frameId: 3, href: "https://portal.example/metadata", title: "Metadata", supportedFilterCount: 1 },
        { frameId: 8, href: "https://portal.example/powerbi", title: "Power BI", supportedFilterCount: 16 }
      ])
    ).toBe(8);
  });

  it("returns undefined when no frame has supported filters", () => {
    expect(
      selectBestFrameForFilters([
        { frameId: 0, href: "https://portal.example/report", title: "Portal", supportedFilterCount: 0 }
      ])
    ).toBeUndefined();
  });
});
