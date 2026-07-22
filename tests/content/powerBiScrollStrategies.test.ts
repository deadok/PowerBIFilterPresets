import { describe, expect, it } from "vitest";
import {
  scanSnapshotsByScrollbarDrag,
  scanSnapshotsByWheel,
  scrollElementForListbox,
  scrollPlanForElement,
  scrollSlicerSnapshotTo,
  type SlicerListboxSnapshot
} from "../../src/content/powerBiScrollStrategies";
import { labelForSlicerOption } from "../../src/content/powerBiDiscovery";
import { createDeterministicPowerBiTiming } from "../../src/content/powerBiTiming";

function snapshotFor(
  listbox: HTMLElement,
  scrollElement: HTMLElement,
  options: HTMLElement[] = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
): SlicerListboxSnapshot {
  return { listbox, scrollElement, options };
}

function signatureForSnapshots(snapshots: SlicerListboxSnapshot[]): string {
  return snapshots
    .map((snapshot) =>
      snapshot.options
        .filter((option) => option.isConnected)
        .map((option) => labelForSlicerOption(option))
        .join("|")
    )
    .join("\n");
}

function topologyForSnapshots(snapshots: SlicerListboxSnapshot[]): string {
  return snapshots.length > 0 ? "live" : "";
}

describe("Power BI scroll strategies", () => {
  it("uses the snapshot-shaped descendant scroll-content instead of the listbox", () => {
    document.body.innerHTML = `
      <div class="slicerBody" role="listbox">
        <div class="scroll-wrapper"><div class="scroll-content"><div role="option">A</div></div></div>
      </div>
    `;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const scrollContent = document.querySelector<HTMLElement>(".scroll-content")!;
    Object.defineProperty(scrollContent, "clientHeight", { configurable: true, value: 40 });
    Object.defineProperty(scrollContent, "scrollHeight", { configurable: true, value: 120 });

    expect(scrollElementForListbox(listbox)).toBe(scrollContent);
  });

  it("builds a bounded deterministic scroll plan from DOM scroll metrics", () => {
    const element = document.createElement("div");

    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 260 },
      scrollTop: { configurable: true, value: 20, writable: true }
    });

    expect(scrollPlanForElement(element)).toEqual({
      completed: true,
      positions: [0, 20, 80, 160],
      wheelFallback: false
    });
  });

  it("scrolls a snapshot through wheel events and scrollTop updates", () => {
    document.body.innerHTML = `
      <div class="scroll-host">
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" title="A">A</div>
        </div>
      </div>
    `;
    const scrollElement = document.querySelector<HTMLElement>(".scroll-host")!;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const wheelEvents: number[] = [];

    Object.defineProperties(scrollElement, {
      scrollTop: { configurable: true, value: 0, writable: true },
      scrollBy: {
        configurable: true,
        value: ({ top }: { top: number }) => {
          scrollElement.scrollTop += top;
        }
      }
    });
    listbox.addEventListener("wheel", (event) => wheelEvents.push((event as WheelEvent).deltaY));

    const scrolled = scrollSlicerSnapshotTo(snapshotFor(listbox, scrollElement), 120);

    expect(scrolled).toBe(true);
    expect(scrollElement.scrollTop).toBe(120);
    expect(wheelEvents).toEqual([120]);
  });

  it("walks virtualized slices through bounded wheel scanning", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <div class="scroll-host">
          <div class="slicerBody" role="listbox" aria-label="Product"></div>
        </div>
      </section>
    `;
    const scrollHost = document.querySelector<HTMLElement>(".scroll-host")!;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const labelsByStep = [
      ["A", "B"],
      ["C", "D"],
      ["E"]
    ];
    let renderStep = 0;
    const render = () => {
      listbox.innerHTML = labelsByStep[renderStep]
        .map((label) => `<div role="option" title="${label}">${label}</div>`)
        .join("");
    };
    render();
    listbox.addEventListener("wheel", () => {
      if (renderStep < labelsByStep.length - 1) {
        renderStep += 1;
        render();
      }
    });

    const seenLabels: string[] = [];
    seenLabels.push(...snapshotFor(listbox, scrollHost).options.map(labelForSlicerOption));
    const completed = await scanSnapshotsByWheel({
      snapshotProvider: () => [snapshotFor(listbox, scrollHost)],
      snapshotsSignature: signatureForSnapshots,
      snapshotsTopology: topologyForSnapshots,
      onOptions: (options) => {
        seenLabels.push(...options.map(labelForSlicerOption));
      },
      intervalMs: 0,
      timing: createDeterministicPowerBiTiming(),
      deadline: 100000
    });

    expect(completed).toEqual({ status: "complete", topology: "live" });
    expect(new Set(seenLabels)).toEqual(new Set(["A", "B", "C", "D", "E"]));
  });

  it("reports wheel budget exhaustion when every bounded step reveals another slice", async () => {
    document.body.innerHTML = `<div role="listbox"><div role="option" title="step-0"></div></div>`;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let step = 0;
    listbox.addEventListener("wheel", () => {
      step += 1;
      listbox.innerHTML = `<div role="option" title="step-${step}"></div>`;
    });

    await expect(
      scanSnapshotsByWheel({
        snapshotProvider: () => [snapshotFor(listbox, listbox)],
        snapshotsSignature: signatureForSnapshots,
        snapshotsTopology: topologyForSnapshots,
        onOptions: () => undefined,
        intervalMs: 0,
        timing: createDeterministicPowerBiTiming(),
        deadline: 100000
      })
    ).resolves.toEqual({ status: "exhausted", topology: "live" });
    expect(step).toBe(40);
  });

  it("walks virtualized slices through visible scrollbar dragging", async () => {
    document.body.innerHTML = `
      <div class="slicer-dropdown-popup">
        <div class="scroll-host">
          <div class="slicerBody" role="listbox" aria-label="Product"></div>
          <div class="scroll-element scroll-y">
            <div class="scroll-element_track"></div>
            <div class="scroll-bar"></div>
          </div>
        </div>
      </div>
    `;
    const scrollHost = document.querySelector<HTMLElement>(".scroll-host")!;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const track = document.querySelector<HTMLElement>(".scroll-element_track")!;
    const scrollBar = document.querySelector<HTMLElement>(".scroll-bar")!;
    const labelsByStep = [
      ["A", "B"],
      ["C", "D"],
      ["E"]
    ];
    let renderStep = 0;
    const render = () => {
      listbox.innerHTML = labelsByStep[renderStep]
        .map((label) => `<div role="option" title="${label}">${label}</div>`)
        .join("");
    };
    render();

    track.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 8, width: 8, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    scrollBar.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 0, right: 8, width: 8, height: 20, x: 0, y: 10, toJSON: () => ({}) });
    let dragCount = 0;
    scrollBar.addEventListener("mouseup", () => {
      dragCount += 1;
      if (dragCount === 1) {
        renderStep = 0;
        render();
        return;
      }
      if (renderStep < labelsByStep.length - 1) {
        renderStep += 1;
        render();
      }
    });

    const seenLabels: string[] = [];
    seenLabels.push(...snapshotFor(listbox, scrollHost).options.map(labelForSlicerOption));
    const completed = await scanSnapshotsByScrollbarDrag({
      snapshotProvider: () => [snapshotFor(listbox, scrollHost)],
      snapshotsSignature: signatureForSnapshots,
      snapshotsTopology: topologyForSnapshots,
      onOptions: (options) => {
        seenLabels.push(...options.map(labelForSlicerOption));
      },
      intervalMs: 0,
      timing: createDeterministicPowerBiTiming(),
      deadline: 100000
    });

    expect(completed).toEqual({ status: "complete", topology: "live" });
    expect(new Set(seenLabels)).toEqual(new Set(["A", "B", "C", "D", "E"]));
  });

  it("reports scrollbar-drag budget exhaustion when every bounded drag reveals another slice", async () => {
    document.body.innerHTML = `
      <div class="slicer-dropdown-popup">
        <div role="listbox"><div role="option" title="step-0"></div></div>
        <div class="scroll-element scroll-y">
          <div class="scroll-element_track"></div><div class="scroll-bar"></div>
        </div>
      </div>
    `;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const track = document.querySelector<HTMLElement>(".scroll-element_track")!;
    const scrollBar = document.querySelector<HTMLElement>(".scroll-bar")!;
    track.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 8, width: 8, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    scrollBar.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 0, right: 8, width: 8, height: 20, x: 0, y: 10, toJSON: () => ({}) });
    let step = 0;
    scrollBar.addEventListener("mouseup", () => {
      step += 1;
      listbox.innerHTML = `<div role="option" title="step-${step}"></div>`;
    });

    await expect(
      scanSnapshotsByScrollbarDrag({
        snapshotProvider: () => [snapshotFor(listbox, listbox)],
        snapshotsSignature: signatureForSnapshots,
        snapshotsTopology: topologyForSnapshots,
        onOptions: () => undefined,
        intervalMs: 0,
        timing: createDeterministicPowerBiTiming(),
        deadline: 100000
      })
    ).resolves.toEqual({ status: "exhausted", topology: "live" });
    expect(step).toBe(31);
  });
});
