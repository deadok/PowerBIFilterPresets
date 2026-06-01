import { describe, expect, it } from "vitest";
import { probeFrameForSupportedFilters, selectBestFrameForFilters } from "../../src/popup/frameTarget";

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

  it("counts slicers that expose search UI instead of a combobox", () => {
    document.body.innerHTML = `
      <section class="visual customPadding visual-slicer">
        <div class="slicer-container">
          <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
          <div class="slicer-content-wrapper">
            <input type="search" placeholder="Search" aria-label="Search" />
          </div>
        </div>
      </section>
    `;

    expect(probeFrameForSupportedFilters().supportedFilterCount).toBe(1);
  });
});
