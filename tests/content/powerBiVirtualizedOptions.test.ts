import { describe, expect, it } from "vitest";
import { labelForSlicerOption, type SlicerControl } from "../../src/content/powerBiDiscovery";
import { createDeterministicPowerBiTiming, type PowerBiTiming } from "../../src/content/powerBiTiming";
import { liveSlicerOptionByLabel, scanSlicerOptions } from "../../src/content/powerBiVirtualizedOptions";

function createScheduledTimingForVirtualizedOptions(onDelay: (delayCount: number) => void): PowerBiTiming {
  let now = 0;
  let delayCount = 0;

  return {
    now: () => now,
    async delay(ms) {
      now += Math.max(1, ms);
      delayCount += 1;
      onDelay(delayCount);
      await Promise.resolve();
    }
  };
}

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

  it("seeds the current rendered rows before moving an already-scrolled listbox", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="scroll-host">
          <div class="slicerBody" role="listbox" aria-label="Product">
            <div role="option" data-row-id="target" title="Target"></div>
          </div>
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
    Object.defineProperties(scrollHost, {
      clientHeight: { configurable: true, value: 40 },
      scrollHeight: { configurable: true, value: 120 }
    });
    scrollHost.scrollTop = 80;
    scrollHost.addEventListener("scroll", () => {
      listbox.innerHTML = `<div role="option" data-row-id="${scrollHost.scrollTop}" title="Row ${scrollHost.scrollTop}"></div>`;
    });
    const observedLabels: string[] = [];

    await expect(
      scanSlicerOptions(document, control, "Product", [listbox.firstElementChild as HTMLElement], (options) => {
        observedLabels.push(...options.map(labelForSlicerOption));
      })
    ).resolves.toBe(true);
    expect(observedLabels[0]).toBe("Target");
  });

  it("stays incomplete when reliable aria-setsize coverage is missing", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" data-row-id="a" aria-setsize="4" title="A"></div>
          <div role="option" data-row-id="b" aria-setsize="4" title="B"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    await expect(
      scanSlicerOptions(document, control, "Product", options, () => undefined, {
        timing: createDeterministicPowerBiTiming()
      })
    ).resolves.toBe(false);
  });

  it("tracks monotonic aria-setsize growth through the final logical row", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="scroll-host"><div class="slicerBody" role="listbox" aria-label="Product"></div></div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const scrollHost = document.querySelector<HTMLElement>(".scroll-host")!;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let loadedRowCount = 4;
    Object.defineProperties(scrollHost, {
      clientHeight: { configurable: true, value: 40 },
      scrollHeight: { configurable: true, get: () => loadedRowCount * 20 }
    });
    const render = () => {
      const start = Math.min(loadedRowCount - 2, Math.floor(scrollHost.scrollTop / 20));
      listbox.innerHTML = Array.from(
        { length: 2 },
        (_value, index) => `<div role="option" data-row-id="row-${start + index + 1}"
          aria-posinset="${start + index + 1}" aria-setsize="${loadedRowCount}" title="Row ${start + index + 1}"></div>`
      ).join("");
    };
    scrollHost.addEventListener("scroll", () => {
      const previousMax = loadedRowCount * 20 - 40;
      if (scrollHost.scrollTop >= previousMax && loadedRowCount < 8) {
        loadedRowCount += 2;
      }
      render();
    });
    render();
    const seenLabels = new Set<string>();

    await expect(
      scanSlicerOptions(document, control, "Product", [], (options) => {
        options.forEach((option) => seenLabels.add(labelForSlicerOption(option)));
      }, { timing: createDeterministicPowerBiTiming() })
    ).resolves.toBe(true);
    expect(seenLabels).toEqual(new Set(Array.from({ length: 8 }, (_value, index) => `Row ${index + 1}`)));
  });

  it("resets logical evidence when a replacement reuses positions for different row ids", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" data-row-id="old-a" aria-posinset="1" aria-setsize="4" title="Old A"></div>
          <div role="option" data-row-id="old-b" aria-posinset="2" aria-setsize="4" title="Old B"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    Object.defineProperties(initialListbox, {
      clientHeight: { configurable: true, value: 40 },
      scrollHeight: { configurable: true, value: 80 }
    });
    initialListbox.addEventListener("scroll", () => {
      if (initialListbox.scrollTop < 40 || !initialListbox.isConnected) {
        return;
      }
      const replacement = document.createElement("div");
      replacement.className = "slicerBody";
      replacement.setAttribute("role", "listbox");
      replacement.setAttribute("aria-label", "Product");
      replacement.innerHTML = `
        <div role="option" data-row-id="new-x" aria-posinset="1" aria-setsize="4" title="New X"></div>
        <div role="option" data-row-id="new-y" aria-posinset="2" aria-setsize="4" title="New Y"></div>
      `;
      Object.defineProperties(replacement, {
        clientHeight: { configurable: true, value: 40 },
        scrollHeight: { configurable: true, value: 80 }
      });
      initialListbox.replaceWith(replacement);
    });

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(initialListbox.querySelectorAll<HTMLElement>('[role="option"]')),
        () => undefined,
        { timing: createDeterministicPowerBiTiming() }
      )
    ).resolves.toBe(false);
  });

  it("keeps disjoint logical windows from the same wheel-driven listbox in one epoch", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product"></div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const windows = [
      Array.from({ length: 8 }, (_value, index) => index + 1),
      Array.from({ length: 8 }, (_value, index) => index + 20),
      Array.from({ length: 11 }, (_value, index) => index + 9)
    ];
    let windowIndex = 0;
    const renderWindow = () => {
      listbox.innerHTML = windows[windowIndex]
        .map(
          (position) =>
            `<div role="option" data-row-id="row-${position}" aria-posinset="${position}" aria-setsize="27" title="Row ${position}"></div>`
        )
        .join("");
    };
    listbox.addEventListener("wheel", (event) => {
      if ((event as WheelEvent).deltaY <= 0 || windowIndex >= windows.length - 1) {
        return;
      }
      windowIndex += 1;
      renderWindow();
    });
    renderWindow();
    const seenLabels = new Set<string>();

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (options) => options.forEach((option) => seenLabels.add(labelForSlicerOption(option))),
        { timing: createDeterministicPowerBiTiming() }
      )
    ).resolves.toBe(true);
    expect(seenLabels).toEqual(
      new Set(Array.from({ length: 27 }, (_value, index) => `Row ${index + 1}`))
    );
  });

  it("starts a new reported epoch when labels replace the same positions without row ids", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          ${Array.from({ length: 4 }, (_value, index) => `<div role="option" aria-posinset="${index + 1}"
            aria-setsize="4" title="Old ${index + 1}"></div>`).join("")}
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let replaced = false;
    const timing = createScheduledTimingForVirtualizedOptions(() => {
      if (replaced) {
        return;
      }
      replaced = true;
      const replacement = initialListbox.cloneNode(false) as HTMLElement;
      replacement.innerHTML = Array.from(
        { length: 4 },
        (_value, index) => `<div role="option" aria-posinset="${index + 1}"
          aria-setsize="4" title="New ${index + 1}"></div>`
      ).join("");
      initialListbox.replaceWith(replacement);
    });
    const seenLabels = new Set<string>();
    let resetCount = 0;

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(initialListbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (options, observation) => {
          if (observation.reset) {
            resetCount += 1;
            seenLabels.clear();
          }
          options.forEach((option) => seenLabels.add(labelForSlicerOption(option)));
        },
        { timing }
      )
    ).resolves.toBe(true);
    expect(resetCount).toBe(1);
    expect(seenLabels).toEqual(new Set(["New 1", "New 2", "New 3", "New 4"]));
  });

  it("fails closed when a metadata-less physical listbox generation is replaced", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option"></div><div role="option"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let replaced = false;
    const timing = createScheduledTimingForVirtualizedOptions(() => {
      if (replaced) {
        return;
      }
      replaced = true;
      const replacement = initialListbox.cloneNode(false) as HTMLElement;
      replacement.innerHTML = '<div role="option"></div><div role="option"></div>';
      initialListbox.replaceWith(replacement);
    });
    let resetCount = 0;

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(initialListbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (_options, observation) => {
          resetCount += Number(observation.reset);
        },
        { timing }
      )
    ).resolves.toBe(false);
    expect(resetCount).toBe(1);
  });

  it("fails closed when a complete logical generation is replaced by metadata-less rows", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" title="A"></div>
          <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="2" title="B"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let replaced = false;
    const timing = createScheduledTimingForVirtualizedOptions(() => {
      if (replaced) {
        return;
      }
      replaced = true;
      const replacement = initialListbox.cloneNode(false) as HTMLElement;
      replacement.innerHTML = '<div role="option"></div><div role="option"></div>';
      initialListbox.replaceWith(replacement);
    });
    let resetCount = 0;

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(initialListbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (_options, observation) => {
          resetCount += Number(observation.reset);
        },
        { timing }
      )
    ).resolves.toBe(false);
    expect(resetCount).toBe(1);
  });

  it("clears complete logical proof when a replacement batch is only partially identifiable", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" title="A"></div>
          <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="2" title="B"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let replaced = false;
    const timing = createScheduledTimingForVirtualizedOptions(() => {
      if (replaced) {
        return;
      }
      replaced = true;
      const replacement = initialListbox.cloneNode(false) as HTMLElement;
      replacement.innerHTML = `
        <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" title="A"></div>
        <div role="option" aria-posinset="2" aria-setsize="2"></div>
      `;
      initialListbox.replaceWith(replacement);
    });
    let resetCount = 0;

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(initialListbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (_options, observation) => {
          resetCount += Number(observation.reset);
        },
        { timing }
      )
    ).resolves.toBe(false);
    expect(resetCount).toBeGreaterThan(0);
  });

  it("clears complete logical proof when the same generation becomes partially identifiable", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" title="A"></div>
          <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="2" title="B"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let changed = false;
    const timing = createScheduledTimingForVirtualizedOptions(() => {
      if (changed) {
        return;
      }
      changed = true;
      listbox.innerHTML = `
        <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" title="A"></div>
        <div role="option" aria-posinset="2" aria-setsize="2"></div>
      `;
    });
    let resetCount = 0;

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (_options, observation) => {
          resetCount += Number(observation.reset);
        },
        { timing }
      )
    ).resolves.toBe(false);
    expect(resetCount).toBeGreaterThan(0);
  });

  it("fails closed when one stated logical batch assigns different identities to the same position", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" title="A"></div>
          <div role="option" data-row-id="x" aria-posinset="1" aria-setsize="2" title="X"></div>
          <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="2" title="B"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let resetCount = 0;

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (_options, observation) => {
          resetCount += Number(observation.reset);
        },
        { timing: createDeterministicPowerBiTiming() }
      )
    ).resolves.toBe(false);
    expect(resetCount).toBeGreaterThan(0);
  });

  it("re-proves logical coverage after a conflicting duplicate batch is replaced by a clean batch", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" title="A"></div>
          <div role="option" data-row-id="x" aria-posinset="1" aria-setsize="2" title="X"></div>
          <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="2" title="B"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let cleaned = false;
    const timing = createScheduledTimingForVirtualizedOptions(() => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      listbox.innerHTML = `
        <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" title="A"></div>
        <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="2" title="B"></div>
      `;
    });
    let resetCount = 0;
    const finalEpochLabels = new Set<string>();

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (options, observation) => {
          resetCount += Number(observation.reset);
          if (observation.reset) {
            finalEpochLabels.clear();
          }
          options.forEach((option) => finalEpochLabels.add(labelForSlicerOption(option)));
        },
        { timing }
      )
    ).resolves.toBe(true);
    expect(resetCount).toBeGreaterThan(0);
    expect(finalEpochLabels).toEqual(new Set(["A", "B"]));
  });

  it("keeps a stable data key identity when selection decoration changes the label", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" data-key="a" aria-posinset="1" aria-setsize="2" title="Alpha"></div>
          <div role="option" data-key="b" aria-posinset="2" aria-setsize="2" title="Beta"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let decorated = false;
    const timing = createScheduledTimingForVirtualizedOptions(() => {
      if (decorated) {
        return;
      }
      decorated = true;
      for (const option of Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))) {
        option.title = `${option.title} (selected)`;
      }
    });
    let resetCount = 0;

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')),
        (_options, observation) => {
          resetCount += Number(observation.reset);
        },
        { timing }
      )
    ).resolves.toBe(true);
    expect(resetCount).toBe(0);
  });

  it("skips custom scrollbar dragging after wheel scanning proves complete logical coverage", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerContainer">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${Array.from({ length: 8 }, (_value, index) => `<div role="option" data-row-id="row-${index + 1}"
              aria-posinset="${index + 1}" aria-setsize="8" title="Row ${index + 1}"></div>`).join("")}
          </div>
          <div class="scroll-element scroll-y"><div class="scroll-element_track"></div><div class="scroll-bar"></div></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const track = document.querySelector<HTMLElement>(".scroll-element_track")!;
    const scrollBar = document.querySelector<HTMLElement>(".scroll-bar")!;
    track.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 8, width: 8, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    scrollBar.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 0, right: 8, width: 8, height: 20, x: 0, y: 10, toJSON: () => ({}) });
    let scrollbarMouseDowns = 0;
    scrollBar.addEventListener("mousedown", () => {
      scrollbarMouseDowns += 1;
    });

    await expect(
      scanSlicerOptions(
        document,
        control,
        "Product",
        Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')),
        () => undefined,
        { timing: createDeterministicPowerBiTiming() }
      )
    ).resolves.toBe(true);
    expect(scrollbarMouseDowns).toBe(0);
  });

  it("stops incomplete when render snapshots never become quiescent within the settle budget", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div role="option" title="A"></div>
        </div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    const option = document.querySelector<HTMLElement>('[role="option"]')!;
    let now = 0;
    let delayCount = 0;
    const timing: PowerBiTiming = {
      now: () => now,
      async delay(ms) {
        now += Math.max(1, ms);
        delayCount += 1;
        option.classList.toggle("render-version");
        await Promise.resolve();
      }
    };

    await expect(scanSlicerOptions(document, control, "Product", [option], () => undefined, { timing })).resolves.toBe(
      false
    );
    expect(delayCount).toBe(60);
  });

  it("times out when identical-geometry listbox generations keep replacing each other", async () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" title="Product">Product</h3>
        <div class="slicerBody" role="listbox" aria-label="Product"><div role="option" title="A"></div></div>
      </section>
    `;
    const control: SlicerControl = {
      kind: "slicer",
      element: document.querySelector<HTMLElement>(".slicer-container")!,
      title: "Product"
    };
    let replacementCount = 0;
    const attachReplacement = (listbox: HTMLElement) => {
      Object.defineProperty(listbox, "clientHeight", { configurable: true, value: 40 });
      Object.defineProperty(listbox, "scrollHeight", { configurable: true, value: 80 });
      listbox.addEventListener(
        "scroll",
        () => {
          replacementCount += 1;
          const replacement = document.createElement("div");
          replacement.className = "slicerBody";
          replacement.setAttribute("role", "listbox");
          replacement.setAttribute("aria-label", "Product");
          replacement.innerHTML = '<div role="option" title="A"></div>';
          attachReplacement(replacement);
          listbox.replaceWith(replacement);
        },
        { once: true }
      );
    };
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    attachReplacement(initialListbox);

    await expect(
      scanSlicerOptions(document, control, "Product", [initialListbox], () => undefined, {
        timing: createDeterministicPowerBiTiming()
      })
    ).resolves.toBe(false);
    expect(replacementCount).toBeGreaterThan(3);
  });
});
