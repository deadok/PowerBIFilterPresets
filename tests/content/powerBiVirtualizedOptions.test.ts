import { describe, expect, it } from "vitest";
import { labelForSlicerOption, type SlicerControl } from "../../src/content/powerBiDiscovery";
import { liveSlicerOptionByLabel, scanSlicerOptions } from "../../src/content/powerBiVirtualizedOptions";

describe("Power BI virtualized option scanning", () => {
  it("scans initial options when no live listbox can be resolved", async () => {
    document.body.innerHTML = `
      <div role="option" title="A"></div>
      <div role="option" title="B"></div>
    `;
    const initialOptions = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    const labels: string[] = [];
    const control: SlicerControl = {
      kind: "slicer",
      element: document.createElement("section"),
      title: "Product"
    };

    const completed = await scanSlicerOptions(document, control, "Product", initialOptions, (options) => {
      labels.push(...options.map(labelForSlicerOption));
    });

    expect(completed).toBe(true);
    expect(labels).toEqual(["A", "B"]);
  });

  it("walks rendered option windows while scanning a virtualized listbox", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="scroll-host">
          <div class="slicerBody" role="listbox" aria-label="Product"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const scrollHost = document.querySelector<HTMLElement>(".scroll-host")!;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const labelsByPosition = new Map([
      [0, ["A", "B"]],
      [80, ["C", "D"]],
      [160, ["E"]]
    ]);
    const renderAtScrollTop = () => {
      const position = Math.min(160, Math.max(0, Math.round(scrollHost.scrollTop / 80) * 80));
      listbox.innerHTML = labelsByPosition
        .get(position)!
        .map((label) => `<div role="option" title="${label}">${label}</div>`)
        .join("");
    };

    Object.defineProperties(scrollHost, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 260 }
    });
    scrollHost.addEventListener("scroll", renderAtScrollTop);
    renderAtScrollTop();

    const scannedLabels: string[] = [];
    const completed = await scanSlicerOptions(document, control, "Product", [], (options) => {
      scannedLabels.push(...options.map(labelForSlicerOption));
    });

    expect(completed).toBe(true);
    expect(new Set(scannedLabels)).toEqual(new Set(["A", "B", "C", "D", "E"]));
    expect(liveSlicerOptionByLabel(document, control, "Product", "E")?.getAttribute("title")).toBe("E");
  });
});
