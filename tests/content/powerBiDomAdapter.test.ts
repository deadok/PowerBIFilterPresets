import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPowerBiDomAdapter as createAdapterWithDefaults } from "../../src/content/powerBiDomAdapter";
import { createDeterministicPowerBiTiming, type PowerBiTiming } from "../../src/content/powerBiTiming";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(testDir, "../fixtures/powerbi-list-filters.html"), "utf8");

describe("createPowerBiDomAdapter", () => {
  let testAbortController: AbortController;
  let testTimers: number[];

  const createAdapter = (root: ParentNode = document, options: { realTime?: boolean } = {}) =>
    createAdapterWithDefaults(root, options.realTime ? {} : { timing: createDeterministicPowerBiTiming() });

  const addDocumentListener = <K extends keyof DocumentEventMap>(
    type: K,
    listener: (this: Document, event: DocumentEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ) => {
    const listenerOptions =
      typeof options === "object"
        ? { ...options, signal: testAbortController.signal }
        : { capture: options, signal: testAbortController.signal };

    document.addEventListener(type, listener, listenerOptions);
  };

  const setTestTimeout = (handler: TimerHandler, timeout?: number, ...arguments_: unknown[]) => {
    const timer = window.setTimeout(handler, timeout, ...arguments_);
    testTimers.push(timer);
    return timer;
  };

  const createScheduledTiming = (onDelay: (delayCount: number) => void): PowerBiTiming => {
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
  };

  const renderBottomPagedSlicer = (options: {
    append?: boolean;
    title: string;
    pages: string[][];
    initiallySelected: string[];
    pageDelaySteps?: number;
    replaceAfterLoadedPages?: number[];
  }) => {
    const rowHeight = 20;
    const visibleRows = 2;
    const selectedLabels = new Set(options.initiallySelected);
    const scrollEvents: number[] = [];
    const pageLoadMarkers: Array<{ eventIndex: number; frontier: number }> = [];
    const replacementPages = new Set(options.replaceAfterLoadedPages ?? []);
    const pageDelaySteps = options.pageDelaySteps ?? 2;
    let loadedPageCount = Math.min(2, options.pages.length);
    let pendingPageDelays = 0;
    let now = 0;
    let clickCount = 0;
    let listbox: HTMLElement;
    let scrollElement: HTMLElement;

    const slicerMarkup = `
      <section data-bottom-paged-slicer="${options.title}" class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="${options.title}" title="${options.title}">${options.title}</h3>
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="${options.title}">
            <div class="scroll-wrapper"><div class="scroll-content"></div></div>
          </div>
          <div class="slicer-dropdown-loader" style="display: none"></div>
        </div>
      </div></section>
    `;
    if (options.append) {
      const main = document.querySelector("main") ?? document.body.appendChild(document.createElement("main"));
      main.insertAdjacentHTML("beforeend", slicerMarkup);
    } else {
      document.body.innerHTML = `<main>${slicerMarkup}</main>`;
    }
    const slicerRoot = Array.from(
      document.querySelectorAll<HTMLElement>("[data-bottom-paged-slicer]")
    ).at(-1)!;

    const loadedLabels = () => options.pages.slice(0, loadedPageCount).flat();
    const renderRows = () => {
      const labels = loadedLabels();
      const start = Math.min(
        Math.max(0, labels.length - visibleRows),
        Math.max(0, Math.floor(scrollElement.scrollTop / rowHeight))
      );
      scrollElement.innerHTML = labels
        .slice(start, start + visibleRows)
        .map(
          (label, index) =>
            `<div role="option" data-row-id="${label}" aria-posinset="${start + index + 1}" aria-setsize="${options.pages.flat().length}" aria-selected="${selectedLabels.has(label)}" title="${label}"></div>`
        )
        .join("");
    };
    const requestNextPageAtBottom = () => {
      const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      if (
        scrollElement.scrollTop < maxScrollTop ||
        loadedPageCount >= options.pages.length ||
        pendingPageDelays > 0
      ) {
        return;
      }
      pendingPageDelays = 1;
      (slicerRoot.querySelector(".slicer-dropdown-loader") as HTMLElement).style.display = "block";
    };
    const attachScrollableGeneration = (nextListbox: HTMLElement, scrollTop: number) => {
      listbox = nextListbox;
      scrollElement = listbox.querySelector<HTMLElement>(".scroll-content")!;
      Object.defineProperties(scrollElement, {
        clientHeight: { configurable: true, value: rowHeight * visibleRows },
        scrollHeight: { configurable: true, get: () => loadedLabels().length * rowHeight }
      });
      scrollElement.scrollTop = scrollTop;
      scrollElement.addEventListener("scroll", () => {
        scrollEvents.push(scrollElement.scrollTop);
        renderRows();
        requestNextPageAtBottom();
      });
      renderRows();
    };
    const loadNextPage = () => {
      const frontier = scrollElement.scrollTop;
      loadedPageCount += 1;
      pageLoadMarkers.push({ eventIndex: scrollEvents.length, frontier });
      pendingPageDelays = 0;

      if (replacementPages.has(loadedPageCount)) {
        const replacement = document.createElement("div");
        replacement.className = "slicerBody";
        replacement.setAttribute("role", "listbox");
        replacement.setAttribute("aria-label", options.title);
        replacement.innerHTML = '<div class="scroll-wrapper"><div class="scroll-content"></div></div>';
        listbox.replaceWith(replacement);
        attachScrollableGeneration(replacement, 0);
      } else {
        renderRows();
      }

      (slicerRoot.querySelector(".slicer-dropdown-loader") as HTMLElement).style.display = "none";
    };

    attachScrollableGeneration(slicerRoot.querySelector<HTMLElement>('[role="listbox"]')!, 0);
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      const label = option?.getAttribute("title");
      if (!option || !label || !slicerRoot.contains(option)) {
        return;
      }
      clickCount += 1;
      if (selectedLabels.has(label)) {
        selectedLabels.delete(label);
      } else {
        selectedLabels.add(label);
      }
      renderRows();
    });

    const timing: PowerBiTiming = {
      now: () => now,
      async delay(ms) {
        now += Math.max(1, ms);
        if (pendingPageDelays > 0) {
          if (pendingPageDelays >= pageDelaySteps) {
            loadNextPage();
          } else {
            pendingPageDelays += 1;
          }
        }
        await Promise.resolve();
      }
    };

    return {
      allLabels: options.pages.flat(),
      clickCount: () => clickCount,
      pageLoadMarkers,
      scrollEvents,
      selectedLabels,
      timing
    };
  };

  const setRenderedSlicerOptionSelected = (option: HTMLElement, selected: boolean) => {
    option.setAttribute("aria-selected", selected ? "true" : "false");
    option.classList.toggle("selected", selected);
    option.querySelectorAll<HTMLElement>(".slicerCheckbox, .selected").forEach((element) => {
      element.classList.toggle("selected", selected);
    });
  };

  const addSlicerOptionClickHandler = () => {
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      setRenderedSlicerOptionSelected(option, option.getAttribute("aria-selected") !== "true");
    });
  };

  const renderUnboundedFallbackSlicer = (withScrollbar: boolean, selected: boolean) => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="Product"></div>
          ${withScrollbar ? '<div class="scroll-element scroll-y"><div class="scroll-element_track"></div><div class="scroll-bar"></div></div>' : ""}
        </div>
      </div></section></main>
    `;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let slice = 0;
    const render = () => {
      listbox.innerHTML = Array.from(
        { length: 8 },
        (_value, index) => `<div role="option" aria-selected="${selected}" title="slice-${slice}-value-${index}">
          <div class="slicerCheckbox${selected ? " selected" : ""}"></div>
          <span class="slicerText">slice-${slice}-value-${index}</span>
        </div>`
      ).join("");
    };
    const advance = () => {
      slice += 1;
      render();
    };
    render();
    listbox.addEventListener("wheel", advance);

    if (withScrollbar) {
      const track = document.querySelector<HTMLElement>(".scroll-element_track")!;
      const scrollBar = document.querySelector<HTMLElement>(".scroll-bar")!;
      track.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 8, width: 8, height: 100, x: 0, y: 0, toJSON: () => ({}) });
      scrollBar.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 0, right: 8, width: 8, height: 20, x: 0, y: 10, toJSON: () => ({}) });
      scrollBar.addEventListener("mouseup", advance);
    }

    addSlicerOptionClickHandler();
  };

  beforeEach(() => {
    testAbortController = new AbortController();
    testTimers = [];
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    document.body.innerHTML = fixture;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testAbortController.abort();
    for (const timer of testTimers) {
      window.clearTimeout(timer);
    }
    document.body.innerHTML = "";
  });

  it("reads selected values from list filters", async () => {
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Region", type: "list", selectedLabels: ["EMEA", "Americas"] },
      { title: "Product", type: "list", selectedLabels: ["Data Platform"] }
    ]);
  });

  it("skips unsupported filters", async () => {
    const adapter = createAdapter(document, { realTime: true });

    const filters = await adapter.readListFilters();
    expect(filters.map((filter) => filter.title)).not.toContain("Revenue");
  });

  it("reads selected values from Power BI slicer listboxes", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-content-wrapper">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div class="slicerItemContainer" role="option" aria-selected="false" title="Select all">
                  <div class="slicerCheckbox"></div>
                  <span class="slicerText">Select all</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="false" title="BI">
                  <div class="slicerCheckbox"></div>
                  <span class="slicerText">BI</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="true" title="Data Platform">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">Data Platform</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["Data Platform"] }
    ]);
  });

  it.each([
    ["all", true],
    ["none", false]
  ] as const)("captures a localized multi-select slicer in %s mode without saving its visible label", async (selectionMode, selected) => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div class="slicerItemContainer" role="option" tabindex="0" aria-posinset="1" data-row-index="0" aria-selected="${selected}" title="Tout sélectionner">
                  <div class="slicerCheckbox${selected ? " selected" : ""}"></div>
                  <span class="slicerText">Tout sélectionner</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-posinset="2" data-row-index="1" aria-selected="${selected}" title="BI">
                  <div class="slicerCheckbox${selected ? " selected" : ""}"></div>
                  <span class="slicerText">BI</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-posinset="3" data-row-index="2" aria-selected="${selected}" title="Data Platform">
                  <div class="slicerCheckbox${selected ? " selected" : ""}"></div>
                  <span class="slicerText">Data Platform</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const adapter = createAdapter(document);

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: [], selectionMode }
    ]);
  });

  it("keeps a localized multi-select subset as ordinary selected labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div class="slicerItemContainer" role="option" aria-selected="false" title="Alles auswählen">
                  <div class="slicerCheckbox"></div>
                  <span class="slicerText">Alles auswählen</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="true" title="BI">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">BI</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="false" title="Data Platform">
                  <div class="slicerCheckbox"></div>
                  <span class="slicerText">Data Platform</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const adapter = createAdapter(document);

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["BI"] }
    ]);
  });

  it("preserves the real first selected value when multi-select has no select-all row", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div class="slicerItemContainer" role="option" tabindex="0" aria-posinset="1" data-row-index="0" aria-selected="true" title="First real value">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">First real value</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-posinset="2" data-row-index="1" aria-selected="false" title="Second real value">
                  <div class="slicerCheckbox"></div>
                  <span class="slicerText">Second real value</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;

    await expect(createAdapter(document).readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["First real value"] }
    ]);
  });

  it.each([
    ["all", true],
    ["none", false]
  ] as const)("round-trips localized %s mode through a closed dropdown after the locale changes", async (selectionMode, sourceSelected) => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Приоритет" title="Приоритет">Приоритет</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="priority_display" aria-controls="priority-popup">
              <div class="slicer-restatement">Résumé localisé</div>
            </div>
          </div>
        </section>
      </main>
    `;
    let localeLabel = "Tout sélectionner";
    let selected = sourceSelected;
    const renderPopup = () => {
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="priority-popup" class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="slicerBody" role="listbox" aria-multiselectable="true" aria-label="priority_display">
              ${[localeLabel, "BI", "Data Platform"]
                .map(
                  (title, index) => `<div class="slicerItemContainer" role="option" aria-posinset="${index + 1}" data-row-index="${index}" aria-selected="${selected}" title="${title}">
                    <div class="slicerCheckbox${selected ? " selected" : ""}"></div>
                    <span class="slicerText">${title}</span>
                  </div>`
                )
                .join("")}
            </div>
          </div>
        </div>`
      );
    };
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        document.querySelector(".slicer-dropdown-popup")?.remove();
      } else {
        renderPopup();
      }
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        document.querySelector(".slicer-dropdown-popup")?.remove();
      }
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option || option !== document.querySelector<HTMLElement>('[role="option"]')) {
        return;
      }
      selected = !selected;
      for (const current of Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))) {
        setRenderedSlicerOptionSelected(current, selected);
      }
    });
    const adapter = createAdapter(document);
    const captured = await adapter.readListFilters();
    expect(captured).toEqual([{ title: "Приоритет", type: "list", selectedLabels: [], selectionMode }]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();

    localeLabel = "すべて選択";
    selected = !sourceSelected;
    await expect(adapter.applyListFilterSelection("Приоритет", [], captured[0]?.selectionMode)).resolves.toMatchObject({
      status: "applied"
    });
    expect(selected).toBe(sourceSelected);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("applies saved all mode through the structural multi-select row after the locale changes", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div class="slicerItemContainer" role="option" aria-selected="false" title="すべて選択">
                  <div class="slicerCheckbox"></div>
                  <span class="slicerText">すべて選択</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="false" title="BI">
                  <div class="slicerCheckbox"></div>
                  <span class="slicerText">BI</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const clickedTitles: string[] = [];
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }
      clickedTitles.push(option.getAttribute("title") ?? "");
      for (const current of Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))) {
        setRenderedSlicerOptionSelected(current, true);
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", [], "all")).resolves.toMatchObject({
      title: "Product",
      status: "applied"
    });
    expect(clickedTitles).toEqual(["すべて選択"]);
    expect(document.querySelector<HTMLElement>('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("applies saved none mode without confusing it with all", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div class="slicerItemContainer selected" role="option" aria-selected="true" title="Выбрать всё">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">Выбрать всё</span>
                </div>
                <div class="slicerItemContainer selected" role="option" aria-selected="true" title="BI">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">BI</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (option !== document.querySelector<HTMLElement>('[role="option"]')) {
        return;
      }
      for (const current of Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))) {
        setRenderedSlicerOptionSelected(current, false);
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["BI"], "none")).resolves.toMatchObject({
      title: "Product",
      status: "applied"
    });
    expect(document.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(0);
  });

  it.each([
    ["all", true],
    ["none", false]
  ] as const)("applies %s mode uniformly when the multi-select slicer has no select-all row", async (selectionMode, expectedSelected) => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div class="slicerItemContainer" role="option" aria-selected="true" title="Alpha">
                  <div class="slicerCheckbox selected"></div><span class="slicerText">Alpha</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="false" title="Beta">
                  <div class="slicerCheckbox"></div><span class="slicerText">Beta</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="true" title="Gamma">
                  <div class="slicerCheckbox selected"></div><span class="slicerText">Gamma</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    addSlicerOptionClickHandler();

    await expect(createAdapter(document).applyListFilterSelection("Product", [], selectionMode)).resolves.toMatchObject({
      status: "applied"
    });
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="option"]'),
        (option) => option.getAttribute("aria-selected") === "true"
      )
    ).toEqual([expectedSelected, expectedSelected, expectedSelected]);
  });

  it("re-resolves an aria-controlled popup after descendant scrolling asynchronously replaces its listbox", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Приоритет" title="Приоритет">Приоритет</h3>
            <input type="search" aria-label="Search" />
            <div role="combobox" aria-label="priority_display" aria-controls="priority-popup"></div>
          </div>
        </section>
        <div id="priority-popup" class="slicer-dropdown-popup">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="slicerBody" role="listbox" aria-label="priority_display">
              <div class="scroll-wrapper"><div class="scroll-content">
                <div role="option" aria-posinset="3" data-row-index="2" aria-selected="true" title="Beta"></div>
                <div role="option" aria-posinset="4" data-row-index="3" aria-selected="true" title="Gamma"></div>
              </div></div>
            </div>
          </div>
        </div>
      </main>
    `;
    const attachScrollMetrics = (element: HTMLElement, scrollTop: number) => {
      Object.defineProperty(element, "clientHeight", { configurable: true, value: 40 });
      Object.defineProperty(element, "scrollHeight", { configurable: true, value: 120 });
      element.scrollTop = scrollTop;
    };
    const initialScrollContent = document.querySelector<HTMLElement>(".scroll-content")!;
    attachScrollMetrics(initialScrollContent, 80);
    let replacementScheduled = false;
    initialScrollContent.addEventListener("scroll", () => {
      if (replacementScheduled) {
        return;
      }
      replacementScheduled = true;
      queueMicrotask(() => {
        document.querySelector("#priority-popup")?.remove();
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div id="priority-popup" class="slicer-dropdown-popup">
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="priority_display">
                <div class="scroll-wrapper"><div class="scroll-content">
                  <div role="option" tabindex="0" aria-posinset="1" data-row-index="0" aria-selected="true" title="Tout sélectionner"></div>
                  <div role="option" aria-posinset="2" data-row-index="1" aria-selected="true" title="Alpha"></div>
                  <div role="option" aria-posinset="3" data-row-index="2" aria-selected="true" title="Beta"></div>
                </div></div>
              </div>
            </div>
          </div>`
        );
      });
    });

    await expect(createAdapter(document).readListFilters()).resolves.toEqual([
      { title: "Приоритет", type: "list", selectedLabels: [], selectionMode: "all" }
    ]);
    expect(replacementScheduled).toBe(true);
  });

  it("omits a multi-select filter when an incomplete scan cannot safely classify its localized first row", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div role="option" tabindex="0" aria-posinset="1" data-row-index="0" aria-selected="true" title="Tout sélectionner"></div>
                <div role="option" aria-posinset="2" data-row-index="1" aria-selected="true" title="Alpha"></div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    Object.defineProperty(listbox, "clientHeight", { configurable: true, value: 1 });
    Object.defineProperty(listbox, "scrollHeight", { configurable: true, value: 1000 });

    await expect(createAdapter(document).readListFilters()).resolves.toEqual([]);
  });

  it.each(["wheel", "scrollbar"] as const)("omits capture when the %s fallback exhausts its bounded scan budget", async (fallback) => {
    renderUnboundedFallbackSlicer(fallback === "scrollbar", true);

    await expect(createAdapter(document).readListFilters()).resolves.toEqual([]);
  });

  it.each(["wheel", "scrollbar"] as const)("times out selectionMode apply when the %s fallback exhausts its bounded scan budget", async (fallback) => {
    renderUnboundedFallbackSlicer(fallback === "scrollbar", false);

    await expect(createAdapter(document).applyListFilterSelection("Product", [], "all")).resolves.toMatchObject({
      title: "Product",
      status: "timeout"
    });
  });

  it("times out selectionMode apply when the controlled popup never yields a listbox or options", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div role="combobox" aria-label="product_internal" aria-controls="missing-popup"></div>
      </div></section></main>
    `;

    await expect(createAdapter(document).applyListFilterSelection("Product", [], "all")).resolves.toMatchObject({
      title: "Product",
      status: "timeout"
    });
  });

  it("times out selectionMode apply when verification re-resolves to an empty replacement listbox", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div role="combobox" aria-label="product_internal" aria-controls="product-popup"></div>
      </div></section></main>
      <div id="product-popup" class="slicer-dropdown-popup"><div class="slicerContainer isMultiSelectEnabled">
        <div class="slicerBody" role="listbox" aria-label="product_internal">
          <div role="option" aria-selected="true" title="Alpha"></div>
          <div role="option" aria-selected="true" title="Beta"></div>
        </div>
      </div></div>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let scanCount = 0;
    initialListbox.addEventListener("scroll", () => {
      scanCount += 1;
      if (scanCount !== 2) {
        return;
      }
      document.querySelector("#product-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="product-popup" class="slicer-dropdown-popup"><div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="product_internal"></div>
        </div></div>`
      );
    });

    await expect(createAdapter(document).applyListFilterSelection("Product", [], "all")).resolves.toMatchObject({
      title: "Product",
      status: "timeout"
    });
    expect(scanCount).toBe(2);
  });

  it("times out selectionMode apply when the live listbox becomes empty after verification observes every identity", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div role="combobox" aria-label="product_internal" aria-controls="product-popup"></div>
      </div></section></main>
      <div id="product-popup" class="slicer-dropdown-popup"><div class="slicerContainer isMultiSelectEnabled">
        <div class="slicerBody" role="listbox" aria-label="product_internal">
          <div role="option" aria-selected="true" title="Alpha"></div>
          <div role="option" aria-selected="true" title="Beta"></div>
        </div>
      </div></div>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const lastOption = initialListbox.querySelector<HTMLElement>('[title="Beta"]')!;
    const getAttribute = lastOption.getAttribute.bind(lastOption);
    let scanCount = 0;
    let replacementScheduled = false;

    initialListbox.addEventListener("scroll", () => {
      scanCount += 1;
    });
    lastOption.getAttribute = (name) => {
      const value = getAttribute(name);
      if (name === "aria-selected" && scanCount === 2 && !replacementScheduled) {
        replacementScheduled = true;
        queueMicrotask(() => {
          document.querySelector("#product-popup")?.remove();
          document.body.insertAdjacentHTML(
            "beforeend",
            `<div id="product-popup" class="slicer-dropdown-popup"><div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="product_internal"></div>
            </div></div>`
          );
        });
      }
      return value;
    };

    await expect(createAdapter(document).applyListFilterSelection("Product", [], "all")).resolves.toMatchObject({
      title: "Product",
      status: "timeout"
    });
    expect(scanCount).toBe(2);
    expect(replacementScheduled).toBe(true);
    expect(document.querySelectorAll('[role="listbox"] [role="option"]')).toHaveLength(0);
  });

  it("waits through transient unchanged snapshots for a delayed ordinary label", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="Product">
            <div role="option" aria-selected="false" title="Alpha"></div>
          </div>
        </div>
      </div></section></main>
    `;
    const timing = createScheduledTiming((delayCount) => {
      if (delayCount === 2) {
        document.querySelector('[role="listbox"]')?.insertAdjacentHTML(
          "beforeend",
          '<div role="option" aria-selected="false" title="Beta"></div>'
        );
      }
    });
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Product", ["Beta"])
    ).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(document.querySelector('[title="Beta"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("waits beyond the first 200ms of unchanged snapshots for a slow ordinary label", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="Product">
            <div role="option" aria-selected="false" title="Alpha"></div>
          </div>
        </div>
      </div></section></main>
    `;
    const timing = createScheduledTiming((delayCount) => {
      if (delayCount === 15) {
        document.querySelector('[role="listbox"]')?.insertAdjacentHTML(
          "beforeend",
          '<div role="option" aria-selected="false" title="Beta"></div>'
        );
      }
    });
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Product", ["Beta"])
    ).resolves.toMatchObject({ status: "applied" });
    expect(document.querySelector('[title="Beta"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("rescans an identical-geometry replacement generation for an ordinary target", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="Product">
            <div role="option" aria-selected="false" title="Placeholder"></div>
          </div>
        </div>
      </div></section></main>
    `;
    const attachMetrics = (listbox: HTMLElement) => {
      Object.defineProperty(listbox, "clientHeight", { configurable: true, value: 40 });
      Object.defineProperty(listbox, "scrollHeight", { configurable: true, value: 80 });
    };
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    attachMetrics(initialListbox);
    let replaced = false;
    initialListbox.addEventListener("scroll", () => {
      if (initialListbox.scrollTop < 40 || replaced) {
        return;
      }
      replaced = true;
      queueMicrotask(() => {
        const replacement = document.createElement("div");
        replacement.className = "slicerBody";
        replacement.setAttribute("role", "listbox");
        replacement.setAttribute("aria-label", "Product");
        replacement.innerHTML = '<div role="option" aria-selected="false" title="Placeholder"></div>';
        attachMetrics(replacement);
        replacement.addEventListener("scroll", () => {
          replacement.innerHTML =
            replacement.scrollTop >= 40
              ? '<div role="option" aria-selected="false" title="Beta"></div>'
              : '<div role="option" aria-selected="false" title="Placeholder"></div>';
        });
        initialListbox.replaceWith(replacement);
      });
    });
    addSlicerOptionClickHandler();

    await expect(createAdapter(document).applyListFilterSelection("Product", ["Beta"])).resolves.toMatchObject({
      status: "applied"
    });
    expect(replaced).toBe(true);
    expect(document.querySelector('[title="Beta"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("recomputes growing scroll metrics before completing ordinary-label discovery", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="Product">
            <div class="scroll-wrapper"><div class="scroll-content">
              <div role="option" aria-selected="false" title="Alpha"></div>
            </div></div>
          </div>
        </div>
      </div></section></main>
    `;
    const scrollContent = document.querySelector<HTMLElement>(".scroll-content")!;
    let scrollHeight = 40;
    Object.defineProperty(scrollContent, "clientHeight", { configurable: true, value: 40 });
    Object.defineProperty(scrollContent, "scrollHeight", { configurable: true, get: () => scrollHeight });
    scrollContent.addEventListener("scroll", () => {
      if (scrollContent.scrollTop >= 40 && !document.querySelector('[title="Beta"]')) {
        scrollContent.insertAdjacentHTML(
          "beforeend",
          '<div role="option" aria-selected="false" title="Beta"></div>'
        );
      }
    });
    const timing = createScheduledTiming((delayCount) => {
      if (delayCount === 2) {
        scrollHeight = 80;
      }
    });
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Product", ["Beta"])
    ).resolves.toMatchObject({ status: "applied" });
    expect(scrollContent.scrollTop).toBe(40);
    expect(document.querySelector('[title="Beta"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("applies the delayed bottom-paged Queue and Team preset completely and idempotently", async () => {
    const queueFixture = renderBottomPagedSlicer({
      title: "Queue",
      pages: [
        ["Queue 1", "Queue 2"],
        ["Queue 3", "Queue 4"],
        ["Queue 5", "Queue 6"],
        ["Queue 7", "Queue 8"]
      ],
      initiallySelected: Array.from({ length: 8 }, (_value, index) => `Queue ${index + 1}`),
      pageDelaySteps: 50,
      replaceAfterLoadedPages: [3]
    });
    const teamFixture = renderBottomPagedSlicer({
      append: true,
      title: "Team",
      pages: [
        ["Red Team", "Blue Team"],
        ["Yellow Team", "Orange Team"],
        ["White Team", "Gray Team"],
        ["Green Team", "Black Team"]
      ],
      initiallySelected: ["Red Team"],
      pageDelaySteps: 55,
      replaceAfterLoadedPages: [4]
    });
    const timing: PowerBiTiming = {
      now: queueFixture.timing.now,
      async delay(ms) {
        await Promise.all([queueFixture.timing.delay(ms), teamFixture.timing.delay(ms)]);
      }
    };
    const adapter = createAdapterWithDefaults(document, { timing });
    const desiredLabels = ["White Team", "Green Team"];
    const expectForwardPageProgress = (fixture: typeof queueFixture) => {
      expect(fixture.pageLoadMarkers).toHaveLength(2);
      for (const marker of fixture.pageLoadMarkers) {
        const nextProgress = fixture.scrollEvents
          .slice(marker.eventIndex)
          .find((scrollTop) => scrollTop !== marker.frontier);
        expect(nextProgress).toBeGreaterThan(marker.frontier);
      }
    };

    await expect(adapter.applyListFilterSelection("Queue", [], "none")).resolves.toMatchObject({ status: "applied" });
    await expect(adapter.applyListFilterSelection("Team", desiredLabels)).resolves.toMatchObject({ status: "applied" });
    expect(queueFixture.selectedLabels).toEqual(new Set());
    expect(teamFixture.selectedLabels).toEqual(new Set(desiredLabels));
    expectForwardPageProgress(queueFixture);
    expectForwardPageProgress(teamFixture);
    const clicksAfterFirstApply = queueFixture.clickCount() + teamFixture.clickCount();

    await expect(adapter.applyListFilterSelection("Queue", [], "none")).resolves.toMatchObject({ status: "applied" });
    await expect(adapter.applyListFilterSelection("Team", desiredLabels)).resolves.toMatchObject({ status: "applied" });
    expect(queueFixture.selectedLabels).toEqual(new Set());
    expect(teamFixture.selectedLabels).toEqual(new Set(desiredLabels));
    expect(queueFixture.clickCount() + teamFixture.clickCount()).toBe(clicksAfterFirstApply);
  });

  it("times out non-destructively when a same-size replacement reuses logical positions for different rows", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Team" title="Team">Team</h3>
        <div class="slicerBody" role="listbox" aria-label="Team">
          <div role="option" data-row-id="old-a" aria-posinset="1" aria-setsize="4" aria-selected="false" title="Old A"></div>
          <div role="option" data-row-id="old-b" aria-posinset="2" aria-setsize="4" aria-selected="false" title="Old B"></div>
        </div>
      </div></section></main>
    `;
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
      replacement.setAttribute("aria-label", "Team");
      replacement.innerHTML = `
        <div role="option" data-row-id="new-x" aria-posinset="1" aria-setsize="4" aria-selected="false" title="New X"></div>
        <div role="option" data-row-id="new-y" aria-posinset="2" aria-setsize="4" aria-selected="false" title="New Y"></div>
      `;
      Object.defineProperties(replacement, {
        clientHeight: { configurable: true, value: 40 },
        scrollHeight: { configurable: true, value: 80 }
      });
      initialListbox.replaceWith(replacement);
    });
    let optionClicks = 0;
    addDocumentListener("click", (event) => {
      if ((event.target as Element).closest('[role="option"]')) {
        optionClicks += 1;
      }
    });

    await expect(createAdapter(document).applyListFilterSelection("Team", ["Old A"])).resolves.toMatchObject({
      status: "timeout"
    });
    expect(optionClicks).toBe(0);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((option) =>
        option.getAttribute("aria-selected")
      )
    ).toEqual(["false", "false"]);
  });

  it("discards a completed old epoch before preflight when its desired label disappears", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Team" title="Team">Team</h3>
        <div class="slicerBody" role="listbox" aria-label="Team">
          <div role="option" aria-posinset="1" aria-setsize="2" aria-selected="false" title="Old A"></div>
          <div role="option" aria-posinset="2" aria-setsize="2" aria-selected="false" title="Old B"></div>
        </div>
      </div></section></main>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let replaced = false;
    const timing = createScheduledTiming(() => {
      if (replaced) {
        return;
      }
      replaced = true;
      const replacement = initialListbox.cloneNode(false) as HTMLElement;
      replacement.innerHTML = `
        <div role="option" aria-posinset="1" aria-setsize="2" aria-selected="false" title="New X"></div>
        <div role="option" aria-posinset="2" aria-setsize="2" aria-selected="false" title="New Y"></div>
      `;
      initialListbox.replaceWith(replacement);
    });
    let optionClicks = 0;
    addDocumentListener("click", (event) => {
      if ((event.target as Element).closest('[role="option"]')) {
        optionClicks += 1;
      }
    });

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Team", ["Old A"])
    ).resolves.toEqual({
      title: "Team",
      status: "missing_value",
      message: "Missing values: Old A."
    });
    expect(optionClicks).toBe(0);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((option) =>
        option.getAttribute("aria-selected")
      )
    ).toEqual(["false", "false"]);
  });

  it("does not report applied when an ordinary mutation epoch is replaced without the desired label", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Team" title="Team">Team</h3>
        <div class="slicerBody" role="listbox" aria-label="Team">
          <div role="option" data-row-id="old-a" aria-posinset="1" aria-setsize="2" aria-selected="false" title="Old A"></div>
          <div role="option" data-row-id="old-b" aria-posinset="2" aria-setsize="2" aria-selected="false" title="Old B"></div>
        </div>
      </div></section></main>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let replacementClicks = 0;
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }
      if (option.getAttribute("data-row-id")?.startsWith("new-")) {
        replacementClicks += 1;
        return;
      }
      setRenderedSlicerOptionSelected(option, true);
      const replacement = initialListbox.cloneNode(false) as HTMLElement;
      replacement.innerHTML = `
        <div role="option" data-row-id="new-x" aria-posinset="1" aria-setsize="2" aria-selected="false" title="New X"></div>
        <div role="option" data-row-id="new-y" aria-posinset="2" aria-setsize="2" aria-selected="false" title="New Y"></div>
      `;
      initialListbox.replaceWith(replacement);
    });

    await expect(createAdapter(document).applyListFilterSelection("Team", ["Old A"])).resolves.toMatchObject({
      status: "timeout"
    });
    expect(replacementClicks).toBe(0);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((option) =>
        option.getAttribute("aria-selected")
      )
    ).toEqual(["false", "false"]);
  });

  it("does not treat a quarantined conflicting row as preflight evidence", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Team" title="Team">Team</h3>
        <div class="slicerBody" role="listbox" aria-label="Team">
          <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" aria-selected="false" title="A"></div>
          <div role="option" data-row-id="x" aria-posinset="1" aria-setsize="2" aria-selected="false" title="X"></div>
          <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="2" aria-selected="false" title="B"></div>
        </div>
      </div></section></main>
    `;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let cleaned = false;
    const timing = createScheduledTiming(() => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      listbox.innerHTML = `
        <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="2" aria-selected="false" title="A"></div>
        <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="2" aria-selected="false" title="B"></div>
      `;
    });
    let optionClicks = 0;
    addDocumentListener("click", (event) => {
      if ((event.target as Element).closest('[role="option"]')) {
        optionClicks += 1;
      }
    });

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Team", ["X"])
    ).resolves.toEqual({
      title: "Team",
      status: "missing_value",
      message: "Missing values: X."
    });
    expect(optionClicks).toBe(0);
  });

  it("aborts mode mutation when a replacement epoch appears before it is independently preflighted", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="Queue">
            <div role="option" data-row-id="old-a" aria-posinset="1" aria-setsize="2" aria-selected="false" title="Old A"></div>
            <div role="option" data-row-id="old-b" aria-posinset="2" aria-setsize="2" aria-selected="false" title="Old B"></div>
          </div>
        </div>
      </div></section></main>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let replacementClicks = 0;
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }
      if (option.getAttribute("data-row-id")?.startsWith("new-")) {
        replacementClicks += 1;
        setRenderedSlicerOptionSelected(option, true);
        return;
      }
      setRenderedSlicerOptionSelected(option, true);
      const replacement = initialListbox.cloneNode(false) as HTMLElement;
      replacement.innerHTML = `
        <div role="option" data-row-id="new-x" aria-posinset="1" aria-setsize="2" aria-selected="false" title="New X"></div>
        <div role="option" data-row-id="new-y" aria-posinset="2" aria-setsize="2" aria-selected="false" title="New Y"></div>
      `;
      initialListbox.replaceWith(replacement);
    });

    await expect(createAdapter(document).applyListFilterSelection("Queue", [], "all")).resolves.toMatchObject({
      status: "timeout"
    });
    expect(replacementClicks).toBe(0);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((option) =>
        option.getAttribute("aria-selected")
      )
    ).toEqual(["false", "false"]);
  });

  it("uses a stable data key while selection decoration changes the displayed label", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="Queue">
            <div role="option" data-key="a" aria-posinset="1" aria-setsize="2" aria-selected="false" title="Alpha"></div>
            <div role="option" data-key="b" aria-posinset="2" aria-setsize="2" aria-selected="false" title="Beta"></div>
          </div>
        </div>
      </div></section></main>
    `;
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }
      setRenderedSlicerOptionSelected(option, true);
      option.title = `${option.title} (selected)`;
    });

    await expect(createAdapter(document).applyListFilterSelection("Queue", [], "all")).resolves.toMatchObject({
      status: "applied"
    });
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((option) =>
        option.getAttribute("aria-selected")
      )
    ).toEqual(["true", "true"]);
  });

  it("returns timeout instead of missing when stated logical coverage remains incomplete", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Team" title="Team">Team</h3>
        <div class="slicerBody" role="listbox" aria-label="Team">
          <div role="option" data-row-id="a" aria-posinset="1" aria-setsize="4" aria-selected="false" title="A"></div>
          <div role="option" data-row-id="b" aria-posinset="2" aria-setsize="4" aria-selected="false" title="B"></div>
        </div>
      </div></section></main>
    `;

    await expect(createAdapter(document).applyListFilterSelection("Team", ["Missing"])).resolves.toMatchObject({
      status: "timeout"
    });
  });

  it("keeps waiting while the scoped dropdown loader is visible", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div role="combobox" aria-label="product_internal" aria-controls="product-popup"></div>
      </div></section></main>
      <div id="product-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="product_internal">
            <div role="option" aria-selected="false" title="Alpha"></div>
          </div>
        </div>
        <div class="slicer-dropdown-loader" style="display: block"></div>
      </div>
    `;
    const timing = createScheduledTiming((delayCount) => {
      if (delayCount === 10) {
        document.querySelector('[role="listbox"]')?.insertAdjacentHTML(
          "beforeend",
          '<div role="option" aria-selected="false" title="Beta"></div>'
        );
        const loader = document.querySelector<HTMLElement>(".slicer-dropdown-loader")!;
        loader.style.display = "none";
      }
    });
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Product", ["Beta"])
    ).resolves.toMatchObject({ status: "applied" });
    expect(document.querySelector('[title="Beta"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it.each([
    ["ordinary", ["Target"], undefined, [false, true]],
    ["selectionMode", [], "all", [true, true]]
  ] as const)("waits beyond 1.5 seconds for loaded Queue rows to settle during %s apply", async (_case, labels, selectionMode, expectedStates) => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="searchHeader show"><input class="searchInput" /></div>
          <div role="listbox" aria-label="queue_internal">
            <div role="option" aria-selected="false" title="Alpha"></div>
            <div role="option" aria-selected="false" title="Target"></div>
          </div>
        </div>
        <div class="slicer-dropdown-loader" style="display: block"></div>
      </div>
    `;
    const timing = createScheduledTiming((delayCount) => {
      if (delayCount === 80) {
        (document.querySelector("#queue-popup .slicer-dropdown-loader") as HTMLElement).style.display = "none";
      }
    });
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Queue", [...labels], selectionMode)
    ).resolves.toMatchObject({ status: "applied" });
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('#queue-popup [role="option"]')).map(
        (option) => option.getAttribute("aria-selected") === "true"
      )
    ).toEqual(expectedStates);
  });

  it("does not partially apply Queue mode before a permanent loader timeout and retries from fresh state", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div role="listbox" aria-label="queue_internal">
            <div role="option" aria-selected="false" title="Alpha"></div>
            <div role="option" aria-selected="false" title="Target"></div>
          </div>
        </div>
        <div class="slicer-dropdown-loader" style="display: block"></div>
      </div>
    `;
    addSlicerOptionClickHandler();
    const adapter = createAdapter(document);
    const selectedStates = () =>
      Array.from(document.querySelectorAll<HTMLElement>('#queue-popup [role="option"]')).map(
        (option) => option.getAttribute("aria-selected") === "true"
      );

    await expect(adapter.applyListFilterSelection("Queue", [], "all")).resolves.toMatchObject({ status: "timeout" });
    expect(selectedStates()).toEqual([false, false]);

    (document.querySelector("#queue-popup .slicer-dropdown-loader") as HTMLElement).style.display = "none";
    await expect(adapter.applyListFilterSelection("Queue", [], "all")).resolves.toMatchObject({ status: "applied" });
    expect(selectedStates()).toEqual([true, true]);
  });

  it("bounds mode resolve, preflight, mutation, and verification to one apply budget", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div role="listbox" aria-label="queue_internal">
            ${Array.from({ length: 4 }, (_value, index) => `<div role="option" aria-selected="false" title="Value ${index}"></div>`).join("")}
          </div>
        </div>
        <div class="slicer-dropdown-loader" style="display: block"></div>
      </div>
    `;
    let now = 0;
    const pendingSelections: Array<{ option: HTMLElement; readyAt: number }> = [];
    const timing: PowerBiTiming = {
      now: () => now,
      async delay(ms) {
        now += Math.max(1, ms);
        if (now >= 6000) {
          (document.querySelector("#queue-popup .slicer-dropdown-loader") as HTMLElement).style.display = "none";
        }
        for (const pending of pendingSelections.splice(0)) {
          if (pending.readyAt <= now) {
            setRenderedSlicerOptionSelected(pending.option, true);
          } else {
            pendingSelections.push(pending);
          }
        }
        await Promise.resolve();
      }
    };
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('#queue-popup [role="option"]');
      if (option && !pendingSelections.some((pending) => pending.option === option)) {
        pendingSelections.push({ option, readyAt: now + 200 });
      }
    });

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Queue", [], "all")
    ).resolves.toMatchObject({ status: "timeout" });
    expect(now).toBeGreaterThanOrEqual(8000);
    expect(now).toBeLessThanOrEqual(8025);
  });

  it.each([
    ["all", false, true],
    ["none", true, false]
  ] as const)(
    "waits through a transient empty replacement before completing %s mode",
    async (selectionMode, initialSelected, expectedSelected) => {
      document.body.innerHTML = `
        <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
          <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="slicerBody" role="listbox" aria-label="Product">
              <div role="option" aria-selected="${initialSelected}" title="Alpha"></div>
            </div>
          </div>
        </div></section></main>
      `;
      let replacementListbox: HTMLElement | null = null;
      const timing = createScheduledTiming((delayCount) => {
        if (delayCount === 2) {
          replacementListbox = document.createElement("div");
          replacementListbox.className = "slicerBody";
          replacementListbox.setAttribute("role", "listbox");
          replacementListbox.setAttribute("aria-label", "Product");
          document.querySelector<HTMLElement>('[role="listbox"]')?.replaceWith(replacementListbox);
        }
        if (delayCount === 6 && replacementListbox) {
          replacementListbox.innerHTML = `
            <div role="option" aria-selected="${expectedSelected}" title="Alpha"></div>
            <div role="option" aria-selected="${!expectedSelected}" title="Beta"></div>
          `;
        }
      });
      addSlicerOptionClickHandler();

      await expect(
        createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Product", [], selectionMode)
      ).resolves.toMatchObject({ status: "applied" });
      expect(
        Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map(
          (option) => option.getAttribute("aria-selected") === "true"
        )
      ).toEqual([expectedSelected, expectedSelected]);
    }
  );

  it.each([
    ["recovers", true, "applied"],
    ["times out", false, "timeout"]
  ] as const)("%s when an aria-controlled >=8-row popup disappears during fallback", async (_case, recover, status) => {
    const renderPopup = () => `
      <div id="product-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="product_internal">
            ${Array.from(
              { length: 8 },
              (_value, index) => `<div role="option" aria-selected="false" title="Value ${index}"></div>`
            ).join("")}
          </div>
        </div>
      </div>
    `;
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div role="combobox" aria-label="product_internal" aria-controls="product-popup"></div>
      </div></section></main>
      ${renderPopup()}
    `;
    document.querySelector<HTMLElement>('[role="listbox"]')!.addEventListener(
      "wheel",
      () => document.querySelector("#product-popup")?.remove(),
      { once: true }
    );
    const timing = createScheduledTiming((delayCount) => {
      if (recover && delayCount === 5 && !document.querySelector("#product-popup")) {
        document.body.insertAdjacentHTML("beforeend", renderPopup());
      }
    });
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Product", [], "all")
    ).resolves.toMatchObject({ status });
    if (recover) {
      expect(
        Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).every(
          (option) => option.getAttribute("aria-selected") === "true"
        )
      ).toBe(true);
    }
  });

  it("reruns wheel fallback after a later scrollbar pass replaces the popup generation", async () => {
    const renderRows = (prefix: string, includeTarget = false) =>
      Array.from(
        { length: 8 },
        (_value, index) =>
          `<div role="option" aria-selected="false" title="${includeTarget && index === 7 ? "Target" : `${prefix} ${index}`}"></div>`
      ).join("");
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div role="combobox" aria-label="product_internal" aria-controls="product-popup"></div>
      </div></section></main>
      <div id="product-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="product_internal">${renderRows("Initial")}</div>
          <div class="scroll-element scroll-y">
            <div class="scroll-element_track"></div><div class="scroll-bar"></div>
          </div>
        </div>
      </div>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let initialWheelCount = 0;
    initialListbox.addEventListener("wheel", () => {
      initialWheelCount += 1;
    });
    const track = document.querySelector<HTMLElement>(".scroll-element_track")!;
    const scrollBar = document.querySelector<HTMLElement>(".scroll-bar")!;
    track.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 8, width: 8, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    scrollBar.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 0, right: 8, width: 8, height: 20, x: 0, y: 10, toJSON: () => ({}) });

    let popupRemoved = false;
    scrollBar.addEventListener(
      "mouseup",
      () => {
        popupRemoved = true;
        document.querySelector("#product-popup")?.remove();
      },
      { once: true }
    );
    let absentDelayCount = 0;
    let replacementWheelCount = 0;
    let targetRevealed = false;
    const timing = createScheduledTiming(() => {
      if (!popupRemoved || document.querySelector("#product-popup")) {
        return;
      }

      absentDelayCount += 1;
      if (absentDelayCount !== 12) {
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="product-popup" class="slicer-dropdown-popup">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="slicerBody" role="listbox" aria-label="product_internal">${renderRows("Replacement")}</div>
          </div>
        </div>`
      );
      const replacementListbox = document.querySelector<HTMLElement>('#product-popup [role="listbox"]')!;
      replacementListbox.addEventListener("wheel", () => {
        replacementWheelCount += 1;
        if (!targetRevealed) {
          targetRevealed = true;
          replacementListbox.innerHTML = renderRows("Replacement", true);
        }
      });
    });
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Product", ["Target"])
    ).resolves.toMatchObject({ status: "applied" });
    expect(initialWheelCount).toBeGreaterThanOrEqual(3);
    expect(popupRemoved).toBe(true);
    expect(absentDelayCount).toBeGreaterThan(9);
    expect(replacementWheelCount).toBeGreaterThan(0);
    expect(document.querySelector('[title="Target"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("reruns wheel fallback after a scrollbar pass atomically swaps the popup generation", async () => {
    const renderRows = (prefix: string, includeTarget = false) =>
      Array.from(
        { length: 8 },
        (_value, index) =>
          `<div role="option" aria-selected="false" title="${includeTarget && index === 7 ? "Target" : `${prefix} ${index}`}"></div>`
      ).join("");
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div role="combobox" aria-label="product_internal" aria-controls="product-popup"></div>
      </div></section></main>
      <div id="product-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="product_internal">${renderRows("Initial")}</div>
          <div class="scroll-element scroll-y">
            <div class="scroll-element_track"></div><div class="scroll-bar"></div>
          </div>
        </div>
      </div>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let initialWheelCount = 0;
    initialListbox.addEventListener("wheel", () => {
      initialWheelCount += 1;
    });
    const track = document.querySelector<HTMLElement>(".scroll-element_track")!;
    const scrollBar = document.querySelector<HTMLElement>(".scroll-bar")!;
    track.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 8, width: 8, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    scrollBar.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 0, right: 8, width: 8, height: 20, x: 0, y: 10, toJSON: () => ({}) });

    let popupReplaced = false;
    let replacementWheelCount = 0;
    let targetRevealed = false;
    scrollBar.addEventListener(
      "mouseup",
      () => {
        popupReplaced = true;
        document.querySelector("#product-popup")?.remove();
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div id="product-popup" class="slicer-dropdown-popup">
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="product_internal">${renderRows("Replacement")}</div>
            </div>
          </div>`
        );
        const replacementListbox = document.querySelector<HTMLElement>('#product-popup [role="listbox"]')!;
        replacementListbox.addEventListener("wheel", () => {
          replacementWheelCount += 1;
          if (!targetRevealed) {
            targetRevealed = true;
            replacementListbox.innerHTML = renderRows("Replacement", true);
          }
        });
      },
      { once: true }
    );
    addSlicerOptionClickHandler();

    await expect(createAdapter(document).applyListFilterSelection("Product", ["Target"])).resolves.toMatchObject({
      status: "applied"
    });
    expect(initialWheelCount).toBeGreaterThanOrEqual(3);
    expect(popupReplaced).toBe(true);
    expect(replacementWheelCount).toBeGreaterThan(0);
    expect(document.querySelector('[title="Target"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("reruns wheel fallback when the final stable observation replaces the popup generation", async () => {
    const renderRows = (prefix: string, includeTarget = false) =>
      Array.from(
        { length: 8 },
        (_value, index) =>
          `<div role="option" aria-selected="false" title="${includeTarget && index === 7 ? "Target" : `${prefix} ${index}`}"></div>`
      ).join("");
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
        <div role="combobox" aria-label="product_internal" aria-controls="product-popup"></div>
      </div></section></main>
      <div id="product-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="slicerBody" role="listbox" aria-label="product_internal">${renderRows("Initial")}</div>
        </div>
      </div>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const lastInitialOption = initialListbox.lastElementChild as HTMLElement;
    const getAttribute = lastInitialOption.getAttribute.bind(lastInitialOption);
    let wheelCount = 0;
    let titleReadsSinceWheel = 0;
    let replacementQueued = false;
    let replacementWheelCount = 0;
    let targetRevealed = false;
    initialListbox.addEventListener("wheel", () => {
      wheelCount += 1;
      titleReadsSinceWheel = 0;
    });
    lastInitialOption.getAttribute = (name) => {
      const value = getAttribute(name);
      if (name === "title" && wheelCount === 4) {
        titleReadsSinceWheel += 1;
        if (titleReadsSinceWheel === 11 && !replacementQueued) {
          replacementQueued = true;
          queueMicrotask(() => {
            document.querySelector("#product-popup")?.remove();
            document.body.insertAdjacentHTML(
              "beforeend",
              `<div id="product-popup" class="slicer-dropdown-popup">
                <div class="slicerContainer isMultiSelectEnabled">
                  <div class="slicerBody" role="listbox" aria-label="product_internal">${renderRows("Replacement")}</div>
                </div>
              </div>`
            );
            const replacementListbox = document.querySelector<HTMLElement>('#product-popup [role="listbox"]')!;
            replacementListbox.addEventListener("wheel", () => {
              replacementWheelCount += 1;
              if (!targetRevealed) {
                targetRevealed = true;
                replacementListbox.innerHTML = renderRows("Replacement", true);
              }
            });
          });
        }
      }
      return value;
    };
    addSlicerOptionClickHandler();

    await expect(createAdapter(document).applyListFilterSelection("Product", ["Target"])).resolves.toMatchObject({
      status: "applied"
    });
    expect(replacementQueued).toBe(true);
    expect(replacementWheelCount).toBeGreaterThan(0);
    expect(document.querySelector('[title="Target"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it.each([
    ["all", false, true],
    ["none", true, false]
  ] as const)("rewinds an already-open virtualized dropdown before applying %s mode", async (selectionMode, initialSelected, expectedSelected) => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <input type="search" aria-label="Search" />
          </div>
        </section>
        <div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="slicer-viewport">
              <div class="slicerBody" role="listbox" aria-label="Product"></div>
            </div>
          </div>
        </div>
      </main>
    `;
    const viewport = document.querySelector<HTMLElement>(".slicer-viewport")!;
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 40 });
    Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 120 });
    let selected = initialSelected;
    const visitedScrollTops: number[] = [];
    const renderRows = () => {
      const labels = viewport.scrollTop === 0 ? ["Seleccionar todo", "Alpha"] : ["Beta", "Gamma"];
      listbox.innerHTML = labels
        .map(
          (title) => `<div class="slicerItemContainer" role="option" aria-selected="${selected}" title="${title}">
            <div class="slicerCheckbox${selected ? " selected" : ""}"></div>
            <span class="slicerText">${title}</span>
          </div>`
        )
        .join("");
    };
    viewport.scrollTop = 80;
    renderRows();
    viewport.addEventListener("scroll", () => {
      visitedScrollTops.push(viewport.scrollTop);
      renderRows();
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option || option.getAttribute("title") !== "Seleccionar todo") {
        return;
      }
      selected = !selected;
      renderRows();
    });

    await expect(createAdapter(document).applyListFilterSelection("Product", [], selectionMode)).resolves.toMatchObject({
      status: "applied"
    });
    expect(visitedScrollTops).toContain(0);
    expect(selected).toBe(expectedSelected);
  });

  it("opens dropdown slicers before reading selected values", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
                <div class="slicer-restatement">All</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicer-dropdown-content">
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="slicerBody" role="listbox" aria-label="Product">
                <div class="slicerItemContainer" role="option" aria-selected="false" title="Tout sélectionner">
                  <div class="slicerCheckbox"></div>
                  <span class="slicerText">Tout sélectionner</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="true" title="ops">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">ops</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="true" title="rating">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">rating</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="true" title="alerts">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">alerts</span>
                </div>
                <div class="slicerItemContainer" role="option" aria-selected="true" title="education">
                  <div class="slicerCheckbox selected"></div>
                  <span class="slicerText">education</span>
                </div>
              </div>
            </div>
          </div>
        </div>`
      );
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["ops", "rating", "alerts", "education"] }
    ]);
  });

  it("preserves already-materialized selected dropdown values before reading other slicers mutates popups", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Направление" title="Направление">Направление</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Направление">
                <div class="slicer-restatement">All</div>
              </div>
            </div>
          </div>
        </section>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Продукт">
                <div class="slicer-restatement">Multiple selections</div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <div class="slicer-dropdown-popup visual themeableElement focused" data-popup-title="Продукт">
        <div class="slicerBody" role="listbox" aria-label="Продукт">
          <div class="slicerItemContainer" role="option" aria-selected="false" title="ЭТРН">
            <div class="slicerCheckbox"></div>
            <span class="slicerText">ЭТРН</span>
          </div>
          <div class="slicerItemContainer" role="option" aria-selected="true" title="Ядро персонализации">
            <div class="slicerCheckbox selected"></div>
            <span class="slicerText">Ядро персонализации</span>
          </div>
          <div class="slicerItemContainer" role="option" aria-selected="true" title="Яндекс Трекер">
            <div class="slicerCheckbox selected"></div>
            <span class="slicerText">Яндекс Трекер</span>
          </div>
        </div>
      </div>
    `;

    document.querySelector<HTMLElement>('[role="combobox"][aria-label="Направление"]')?.addEventListener("click", () => {
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused" data-popup-title="Направление">
          <div class="slicerBody" role="listbox" aria-label="Направление">
            <div class="slicerItemContainer" role="option" aria-selected="false" title="Data">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">Data</span>
            </div>
          </div>
        </div>`
      );
    });
    document.querySelector<HTMLElement>('[role="combobox"][aria-label="Продукт"]')?.addEventListener("click", () => {
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused" data-popup-title="Продукт">
          <div class="slicerBody" role="listbox" aria-label="Продукт">
            <div class="slicerItemContainer" role="option" aria-selected="false" title="Аналитика">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">Аналитика</span>
            </div>
          </div>
        </div>`
      );
    });

    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Направление", type: "list", selectedLabels: [] },
      { title: "Продукт", type: "list", selectedLabels: ["Ядро персонализации", "Яндекс Трекер"] }
    ]);
  });

  it("preserves selected dropdown values hidden by an active text filter while saving", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Task type" title="Task type">Task type</h3>
            <div class="slicer-content-wrapper">
              <input type="search" placeholder="Search" aria-label="Search" />
            </div>
          </div>
        </section>
      </main>
      <div class="slicer-dropdown-popup visual themeableElement focused">
        <div class="slicer-dropdown-content">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="searchHeader show">
              <input type="text" class="searchInput" aria-label="Search" placeholder="Search" />
            </div>
            <div class="slicerBody" role="listbox" aria-label="Task type">
              <div class="slicerItemContainer" role="option" aria-selected="false" title="Seleccionar todo">
                <div class="slicerCheckbox"></div>
                <span class="slicerText">Seleccionar todo</span>
              </div>
              <div class="slicerItemContainer" role="option" aria-selected="true" title="Story">
                <div class="slicerCheckbox selected"></div>
                <span class="slicerText">Story</span>
              </div>
              <div class="slicerItemContainer" role="option" aria-selected="false" title="Substory">
                <div class="slicerCheckbox"></div>
                <span class="slicerText">Substory</span>
              </div>
              <div class="slicerItemContainer" role="option" aria-selected="true" title="Tech debt">
                <div class="slicerCheckbox selected"></div>
                <span class="slicerText">Tech debt</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.querySelector<HTMLInputElement>(".searchHeader.show input.searchInput")!.value = "Sto";
    const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Task type"]');
    expect(listbox).not.toBeNull();
    listbox!.addEventListener(
      "scroll",
      () => {
        const hiddenSelectedOption = listbox!.querySelector<HTMLElement>('[title="Tech debt"]');
        hiddenSelectedOption?.remove();
      },
      { once: true }
    );

    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Task type", type: "list", selectedLabels: ["Story", "Tech debt"] }
    ]);
  });

  it.each([
    ["selected", [true, true], ["Story", "Substory"]],
    ["unselected", [false, false], []],
    ["mixed", [true, false], ["Story"]]
  ] as const)("keeps active-search %s results as ordinary selected labels", async (_state, selectedStates, expectedLabels) => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Task type" title="Task type">Task type</h3>
            <input type="search" />
          </div>
        </section>
      </main>
      <div class="slicer-dropdown-popup visual themeableElement focused">
        <div class="slicer-dropdown-content">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="searchHeader show">
              <input type="text" class="searchInput" aria-label="Buscar" placeholder="Suchen" />
            </div>
            <div class="slicerBody" role="listbox" aria-label="Task type">
              <div class="slicerItemContainer" role="option" aria-selected="${selectedStates[0]}" title="Story">
                <div class="slicerCheckbox${selectedStates[0] ? " selected" : ""}"></div>
                <span class="slicerText">Story</span>
              </div>
              <div class="slicerItemContainer" role="option" aria-selected="${selectedStates[1]}" title="Substory">
                <div class="slicerCheckbox${selectedStates[1] ? " selected" : ""}"></div>
                <span class="slicerText">Substory</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.querySelector<HTMLInputElement>(".searchHeader.show input.searchInput")!.value = "Sto";

    await expect(createAdapter(document).readListFilters()).resolves.toEqual([
      { title: "Task type", type: "list", selectedLabels: expectedLabels }
    ]);
  });

  it.each([
    ["empty", "", true, "all"],
    ["whitespace-only", "   ", false, "none"]
  ] as const)("still captures %s search input as semantic %s", async (_queryKind, query, selected, selectionMode) => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Task type" title="Task type">Task type</h3>
            <input type="search" />
          </div>
        </section>
      </main>
      <div class="slicer-dropdown-popup visual themeableElement focused">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="searchHeader show"><input type="text" class="searchInput" /></div>
          <div class="slicerBody" role="listbox" aria-label="Task type">
            <div role="option" aria-selected="${selected}" title="Story"></div>
            <div role="option" aria-selected="${selected}" title="Substory"></div>
          </div>
        </div>
      </div>
    `;
    document.querySelector<HTMLInputElement>(".searchHeader.show input.searchInput")!.value = query;

    await expect(createAdapter(document).readListFilters()).resolves.toEqual([
      { title: "Task type", type: "list", selectedLabels: [], selectionMode }
    ]);
  });

  it("keeps labels when a replacement listbox appears with an active search query during the scan", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Task type" title="Task type">Task type</h3>
            <div role="combobox" aria-label="task_type_internal" aria-controls="task-popup"></div>
          </div>
        </section>
      </main>
      <div id="task-popup" class="slicer-dropdown-popup visual themeableElement focused">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="searchHeader show"><input type="text" class="searchInput" /></div>
          <div class="slicerBody" role="listbox" aria-label="task_type_internal">
            <div role="option" aria-selected="true" title="Story"></div>
            <div role="option" aria-selected="true" title="Substory"></div>
          </div>
        </div>
      </div>
    `;
    const initialListbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    let replaced = false;
    initialListbox.addEventListener(
      "scroll",
      () => {
        document.querySelector("#task-popup")?.remove();
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div id="task-popup" class="slicer-dropdown-popup visual themeableElement focused">
            <div class="slicerContainer isMultiSelectEnabled">
              <div class="searchHeader show"><input type="text" class="searchInput" /></div>
              <div class="slicerBody" role="listbox" aria-label="task_type_internal">
                <div role="option" aria-selected="true" title="Story"></div>
                <div role="option" aria-selected="true" title="Substory"></div>
              </div>
            </div>
          </div>`
        );
        document.querySelector<HTMLInputElement>("#task-popup input.searchInput")!.value = "Sto";
        replaced = true;
      },
      { once: true }
    );

    await expect(createAdapter(document).readListFilters()).resolves.toEqual([
      { title: "Task type", type: "list", selectedLabels: ["Story", "Substory"] }
    ]);
    expect(replaced).toBe(true);
  });

  it("preserves capture discovery for a connected hidden aria-controlled snapshot", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup" style="display: none">
        <div class="slicerContainer isMultiSelectEnabled">
          <div role="listbox" aria-label="queue_internal">
            <div role="option" aria-selected="true" title="Saved"></div>
            <div role="option" aria-selected="false" title="Other"></div>
          </div>
        </div>
      </div>
    `;

    await expect(createAdapter(document).readListFilters()).resolves.toEqual([
      { title: "Queue", type: "list", selectedLabels: ["Saved"] }
    ]);
  });

  it("bounds capture resolve and scan to one capture budget", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div role="listbox" aria-label="queue_internal"></div>
        </div>
        <div class="slicer-dropdown-loader" style="display: block"></div>
      </div>
    `;
    let now = 0;
    const timing: PowerBiTiming = {
      now: () => now,
      async delay(ms) {
        now += Math.max(1, ms);
        await Promise.resolve();
      }
    };

    await expect(createAdapterWithDefaults(document, { timing }).readListFilters()).resolves.toEqual([
      { title: "Queue", type: "list", selectedLabels: [] }
    ]);
    expect(now).toBeGreaterThanOrEqual(3000);
    expect(now).toBeLessThanOrEqual(3025);
  });

  it("reopens generic multi-select dropdowns when a stale external listbox has no selected options", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Продукт">
                <div class="slicer-restatement">Multiple selections</div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <div class="slicer-dropdown-popup visual themeableElement focused" data-popup-title="Продукт">
        <div class="slicerBody" role="listbox" aria-label="Продукт">
          <div class="slicerItemContainer" role="option" aria-selected="false" title="Аналитика">
            <div class="slicerCheckbox"></div>
            <span class="slicerText">Аналитика</span>
          </div>
          <div class="slicerItemContainer" role="option" aria-selected="false" title="Боты">
            <div class="slicerCheckbox"></div>
            <span class="slicerText">Боты</span>
          </div>
        </div>
      </div>
    `;
    let productOpened = false;
    document.querySelector<HTMLElement>('[role="combobox"][aria-label="Продукт"]')?.addEventListener("click", () => {
      productOpened = true;
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused" data-popup-title="Продукт">
          <div class="slicerBody" role="listbox" aria-label="Продукт">
            <div class="slicerItemContainer" role="option" aria-selected="false" title="ЭТРН">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">ЭТРН</span>
            </div>
            <div class="slicerItemContainer" role="option" aria-selected="true" title="Ядро персонализации">
              <div class="slicerCheckbox selected"></div>
              <span class="slicerText">Ядро персонализации</span>
            </div>
            <div class="slicerItemContainer" role="option" aria-selected="true" title="Яндекс Трекер">
              <div class="slicerCheckbox selected"></div>
              <span class="slicerText">Яндекс Трекер</span>
            </div>
          </div>
        </div>`
      );
    });

    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Продукт", type: "list", selectedLabels: ["Ядро персонализации", "Яндекс Трекер"] }
    ]);
    expect(productOpened).toBe(true);
  });

  it("closes dropdown slicer popups opened while reading selected values", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
                <div class="slicer-restatement">All</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]');
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    combobox?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            <div class="slicerItemContainer" role="option" aria-selected="true" title="ops">
              <div class="slicerCheckbox selected"></div>
              <span class="slicerText">ops</span>
            </div>
            <div class="slicerItemContainer" role="option" aria-selected="false" title="rating">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">rating</span>
            </div>
          </div>
        </div>`
      );
    });
    addSlicerOptionClickHandler();
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["ops"] }
    ]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("closes dropdown slicer popups opened while reading even when no external options are found", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
                <div class="slicer-restatement">All</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]');
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    combobox?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product"></div>
        </div>`
      );
    });
    addSlicerOptionClickHandler();
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([{ title: "Product", type: "list", selectedLabels: [] }]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("reads selected values from virtualized dropdown slicers after scrolling", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Продукт">
                <div class="slicer-restatement">All</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ГЕО и сервисы"]);
    const labels = ["коммуникации", "обучение", "оповещения", "ГЕО и сервисы"];
    const rowHeight = 20;
    const visibleRows = 2;
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const visibleLabelsFor = (scrollTop: number) => {
      const start = Math.min(labels.length - visibleRows, Math.floor(scrollTop / rowHeight));
      return labels.slice(start, start + visibleRows);
    };
    const renderVisibleOptions = (listbox: HTMLElement) => {
      listbox.innerHTML = visibleLabelsFor(listbox.scrollTop).map(renderOption).join("");
    };
    const attachVirtualScrollMetrics = (listbox: HTMLElement) => {
      Object.defineProperty(listbox, "clientHeight", { configurable: true, value: rowHeight * visibleRows });
      Object.defineProperty(listbox, "scrollHeight", { configurable: true, value: rowHeight * labels.length });
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Продукт"></div>
        </div>`
      );
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Продукт"]');
      expect(listbox).not.toBeNull();
      attachVirtualScrollMetrics(listbox!);
      listbox!.scrollTop = 0;
      renderVisibleOptions(listbox!);
      listbox!.addEventListener("scroll", () => renderVisibleOptions(listbox!));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Продукт", type: "list", selectedLabels: ["ГЕО и сервисы"] }
    ]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("waits for delayed virtualized dropdown options while reading selected values", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Продукт">
                <div class="slicer-restatement">All</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ГЕО и сервисы"]);
    const labels = ["коммуникации", "обучение", "ГЕО и сервисы"];
    const rowHeight = 20;
    const visibleRows = 2;
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const visibleLabelsFor = (scrollTop: number) => {
      const start = Math.min(labels.length - visibleRows, Math.floor(scrollTop / rowHeight));
      return labels.slice(start, start + visibleRows);
    };
    const renderVisibleOptions = (listbox: HTMLElement) => {
      listbox.innerHTML = visibleLabelsFor(listbox.scrollTop).map(renderOption).join("");
    };
    const attachVirtualScrollMetrics = (listbox: HTMLElement) => {
      Object.defineProperty(listbox, "clientHeight", { configurable: true, value: rowHeight * visibleRows });
      Object.defineProperty(listbox, "scrollHeight", { configurable: true, value: rowHeight * labels.length });
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Продукт"></div>
        </div>`
      );
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Продукт"]');
      expect(listbox).not.toBeNull();
      attachVirtualScrollMetrics(listbox!);
      listbox!.scrollTop = 0;
      renderVisibleOptions(listbox!);
      listbox!.addEventListener("scroll", () => {
        setTestTimeout(() => renderVisibleOptions(listbox!), 75);
      });
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Продукт", type: "list", selectedLabels: ["ГЕО и сервисы"] }
    ]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("uses wheel scanning when virtualized dropdowns do not expose scroll metrics", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Продукт">
                <div class="slicer-restatement">Multiple selections</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["Ядро персонализации", "Яндекс Трекер"]);
    const slices = [
      ["Select all", "(Blank)", "коммуникации", "обучение", "оповещения", "рейтинг", "Ally", "AuditorTG"],
      ["OAuth Interaction", "Platform", "PLC", "Power BI", "ReviewBot", "Rules", "Tealpos", "WEB интерфейс"],
      [
        "Учет ТМЦ",
        "Фискализация",
        "Ценообразование",
        "ЭТРН",
        "Ядро персонализации",
        "Яндекс Трекер",
        "Яндекс.Еда",
        "Яндекс.Лавка"
      ]
    ];
    let sliceIndex = 0;
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const renderVisibleOptions = (listbox: HTMLElement) => {
      listbox.innerHTML = slices[sliceIndex].map(renderOption).join("");
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Продукт"></div>
        </div>`
      );
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Продукт"]');
      expect(listbox).not.toBeNull();
      renderVisibleOptions(listbox!);
      listbox!.addEventListener("wheel", (event) => {
        if (event.deltaY > 0 && sliceIndex < slices.length - 1) {
          sliceIndex += 1;
          setTestTimeout(() => renderVisibleOptions(listbox!), 75);
        }
      });
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Продукт", type: "list", selectedLabels: ["Ядро персонализации", "Яндекс Трекер"] }
    ]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("falls back to the combobox summary text when a closed virtualized dropdown hides the selected option", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Продукт">
                <div class="slicer-restatement">ГЕО и сервисы</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Продукт">
            <div class="slicerItemContainer" role="option" aria-selected="false" title="коммуникации">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">коммуникации</span>
            </div>
            <div class="slicerItemContainer" role="option" aria-selected="false" title="обучение">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">обучение</span>
            </div>
          </div>
        </div>`
      );
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Продукт", type: "list", selectedLabels: ["ГЕО и сервисы"] }
    ]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("does not treat generic multi-select combobox summaries as saved labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
            <div class="slicer-content-wrapper">
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Продукт">
                <div class="slicer-restatement">Multiple selections</div>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Продукт">
            <div class="slicerItemContainer" role="option" aria-selected="false" title="коммуникации">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">коммуникации</span>
            </div>
            <div class="slicerItemContainer" role="option" aria-selected="false" title="обучение">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">обучение</span>
            </div>
          </div>
        </div>`
      );
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.readListFilters()).resolves.toEqual([{ title: "Продукт", type: "list", selectedLabels: [] }]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("clears current selection and applies saved labels", async () => {
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Region", ["APAC"])).resolves.toEqual({
      title: "Region",
      status: "applied",
      message: "Applied 1 value."
    });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Region", type: "list", selectedLabels: ["APAC"] },
      { title: "Product", type: "list", selectedLabels: ["Data Platform"] }
    ]);
  });

  it("logs clear and select transitions while applying saved labels", async () => {
    const debugSpy = vi.mocked(console.debug);
    const adapter = createAdapter(document, { realTime: true });

    await adapter.applyListFilterSelection("Region", ["APAC"]);

    expect(debugSpy).toHaveBeenCalledWith(
      "[Power BI Presets]",
      "Clearing filter value",
      expect.objectContaining({
        title: "Region",
        label: "EMEA",
        beforeSelected: true,
        afterSelected: false
      })
    );
    expect(debugSpy).toHaveBeenCalledWith(
      "[Power BI Presets]",
      "Selecting filter value",
      expect.objectContaining({
        title: "Region",
        label: "APAC",
        beforeSelected: false,
        afterSelected: true
      })
    );
  });

  it("clears and applies values in Power BI slicer listboxes", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerBody" role="listbox" aria-label="Product">
              <div class="slicerItemContainer" role="option" aria-selected="false" title="BI">
                <div class="slicerCheckbox"></div>
                <span class="slicerText">BI</span>
              </div>
              <div class="slicerItemContainer" role="option" aria-selected="true" title="Data Platform">
                <div class="slicerCheckbox selected"></div>
                <span class="slicerText">Data Platform</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    addSlicerOptionClickHandler();
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["BI"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["BI"] }
    ]);
  });

  it("reports failed slicer interactions without mutating option state", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerBody" role="listbox" aria-label="Product">
              <div class="slicerItemContainer" role="option" aria-selected="false" title="BI">
                <div class="slicerCheckbox"></div>
                <span class="slicerText">BI</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["BI"])).resolves.toEqual({
      title: "Product",
      status: "interaction_failed",
      message: "Could not update values: BI."
    });

    const option = document.querySelector<HTMLElement>('[role="option"][title="BI"]');
    expect(option?.getAttribute("aria-selected")).toBe("false");
    expect(option?.querySelector(".slicerCheckbox")?.classList.contains("selected")).toBe(false);
  });

  it("opens dropdown slicers before applying saved labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${renderOption("ops")}
            ${renderOption("rating")}
          </div>
        </div>`
      );
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }
      const title = option?.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["rating"] }
    ]);
  });

  it("clears the controlled popup search before applying an ordinary label from the full domain", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="unrelated-popup" class="slicer-dropdown-popup">
        <div class="searchHeader show"><input class="searchInput" value="leave me" /></div>
        <div role="listbox" aria-label="unrelated"><div role="option" title="Decoy"></div></div>
      </div>
    `;
    const selectedTitles = new Set(["Projected"]);
    const renderOption = (title: string) =>
      `<div role="option" aria-selected="${selectedTitles.has(title)}" title="${title}"></div>`;
    let searchCleared = false;
    let inputEvents = 0;
    let changeEvents = 0;
    let delaysAfterClear = 0;
    let controlledListbox: HTMLElement | null = null;
    let loader: HTMLElement | null = null;
    const closePopup = () => document.querySelector("#queue-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')!.addEventListener("click", () => {
      if (document.querySelector("#queue-popup")) {
        return;
      }
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="queue-popup" class="slicer-dropdown-popup">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="searchHeader show"><input class="searchInput" /></div>
            <div role="listbox" aria-label="queue_internal">${renderOption("Projected")}</div>
          </div>
          <div class="slicer-dropdown-loader" style="display: none"></div>
        </div>`
      );
      controlledListbox = document.querySelector<HTMLElement>('#queue-popup [role="listbox"]');
      loader = document.querySelector<HTMLElement>("#queue-popup .slicer-dropdown-loader");
      const input = document.querySelector<HTMLInputElement>("#queue-popup input.searchInput")!;
      input.value = "cible";
      input.addEventListener("input", () => {
        inputEvents += 1;
        searchCleared = input.value === "";
        if (loader) {
          loader.style.display = "block";
        }
      });
      input.addEventListener("change", () => {
        changeEvents += 1;
      });
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('#queue-popup [role="option"]');
      const label = option?.getAttribute("title");
      if (!option || !label) {
        return;
      }
      if (selectedTitles.has(label)) {
        selectedTitles.delete(label);
      } else {
        selectedTitles.add(label);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(label));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const timing = createScheduledTiming(() => {
      if (searchCleared) {
        delaysAfterClear += 1;
      }
      if (delaysAfterClear === 5 && controlledListbox && loader) {
        controlledListbox.innerHTML = `${renderOption("Projected")}${renderOption("Target")}`;
        loader.style.display = "none";
      }
    });

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Queue", ["Target"])
    ).resolves.toMatchObject({ status: "applied" });
    expect(inputEvents).toBe(1);
    expect(changeEvents).toBe(1);
    expect(document.querySelector<HTMLInputElement>("#unrelated-popup input")?.value).toBe("leave me");
    expect(selectedTitles).toEqual(new Set(["Target"]));
  });

  it("clears the controlled popup search before applying selectionMode to the full domain", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
    `;
    const closePopup = () => document.querySelector("#queue-popup")?.remove();
    let inputEvents = 0;
    document.querySelector<HTMLElement>('[role="combobox"]')!.addEventListener("click", () => {
      if (document.querySelector("#queue-popup")) {
        return;
      }
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="queue-popup" class="slicer-dropdown-popup">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="searchHeader show"><input class="searchInput" /></div>
            <div role="listbox" aria-label="queue_internal">
              <div role="option" aria-selected="false" title="Projeté"></div>
            </div>
          </div>
          <div class="slicer-dropdown-loader" style="display: none"></div>
        </div>`
      );
      const input = document.querySelector<HTMLInputElement>("#queue-popup input.searchInput")!;
      input.value = "projeté";
      input.addEventListener("input", () => {
        inputEvents += 1;
        document.querySelector('#queue-popup [role="listbox"]')!.innerHTML = `
          <div role="option" aria-selected="false" title="Alpha"></div>
          <div role="option" aria-selected="false" title="Target"></div>
        `;
      });
    });
    addSlicerOptionClickHandler();
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });

    await expect(createAdapter(document).applyListFilterSelection("Queue", [], "all")).resolves.toMatchObject({
      status: "applied"
    });
    expect(inputEvents).toBe(1);
  });

  it.each([
    ["ordinary", ["Target"], undefined, [false, true]],
    ["selectionMode", [], "all", [true, true]]
  ] as const)("reuses a zero-row searched popup without toggling it closed for %s apply", async (_case, labels, selectionMode, expectedStates) => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="searchHeader show"><input class="searchInput" /></div>
          <div role="listbox" aria-label="queue_internal"></div>
        </div>
        <div class="slicer-dropdown-loader" style="display: block"></div>
      </div>
    `;
    const input = document.querySelector<HTMLInputElement>("#queue-popup input.searchInput")!;
    input.value = "aucun résultat";
    let comboboxClicks = 0;
    let inputEvents = 0;
    document.querySelector<HTMLElement>('[role="combobox"]')!.addEventListener("click", () => {
      comboboxClicks += 1;
      document.querySelector("#queue-popup")?.remove();
    });
    input.addEventListener("input", () => {
      inputEvents += 1;
    });
    const timing = createScheduledTiming((delayCount) => {
      if (inputEvents > 0 && delayCount === 5) {
        document.querySelector('#queue-popup [role="listbox"]')!.innerHTML = `
          <div role="option" aria-selected="false" title="Alpha"></div>
          <div role="option" aria-selected="false" title="Target"></div>
        `;
        (document.querySelector("#queue-popup .slicer-dropdown-loader") as HTMLElement).style.display = "none";
      }
    });
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Queue", [...labels], selectionMode)
    ).resolves.toMatchObject({ status: "applied" });
    expect(comboboxClicks).toBe(0);
    expect(inputEvents).toBe(1);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('#queue-popup [role="option"]')).map(
        (option) => option.getAttribute("aria-selected") === "true"
      )
    ).toEqual(expectedStates);
  });

  it("bounds a permanently empty searched popup without toggling it closed", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="searchHeader show"><input class="searchInput" /></div>
          <div role="listbox" aria-label="queue_internal"></div>
        </div>
        <div class="slicer-dropdown-loader" style="display: block"></div>
      </div>
    `;
    document.querySelector<HTMLInputElement>("#queue-popup input.searchInput")!.value = "none";
    let comboboxClicks = 0;
    document.querySelector<HTMLElement>('[role="combobox"]')!.addEventListener("click", () => {
      comboboxClicks += 1;
      document.querySelector("#queue-popup")?.remove();
    });
    let now = 0;
    const timing: PowerBiTiming = {
      now: () => now,
      async delay(ms) {
        now += Math.max(1, ms);
        await Promise.resolve();
      }
    };

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Queue", ["Target"])
    ).resolves.toMatchObject({ status: "timeout" });
    expect(comboboxClicks).toBe(0);
    expect(now).toBeGreaterThanOrEqual(8000);
    expect(now).toBeLessThanOrEqual(8025);
  });

  it("counts initial wheel fallback work against the same apply budget as search resolution", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="searchHeader show"><input class="searchInput" /></div>
          <div role="listbox" aria-label="queue_internal"></div>
        </div>
        <div class="slicer-dropdown-loader" style="display: block"></div>
      </div>
    `;
    document.querySelector<HTMLInputElement>("#queue-popup input.searchInput")!.value = "delayed";
    let now = 0;
    let rowsRendered = false;
    const timing: PowerBiTiming = {
      now: () => now,
      async delay(ms) {
        now += Math.max(1, ms);
        if (!rowsRendered && now >= 7000) {
          rowsRendered = true;
          document.querySelector('#queue-popup [role="listbox"]')!.innerHTML = Array.from(
            { length: 8 },
            (_value, index) => `<div role="option" aria-selected="false" title="${index === 7 ? "Target" : `Value ${index}`}"></div>`
          ).join("");
          (document.querySelector("#queue-popup .slicer-dropdown-loader") as HTMLElement).style.display = "none";
        }
        await Promise.resolve();
      }
    };
    addSlicerOptionClickHandler();

    await expect(
      createAdapterWithDefaults(document, { timing }).applyListFilterSelection("Queue", ["Target"])
    ).resolves.toMatchObject({ status: "timeout" });
    expect(rowsRendered).toBe(true);
    expect(now).toBeGreaterThanOrEqual(8000);
    expect(now).toBeLessThanOrEqual(8025);
  });

  it("opens the combobox instead of accepting a hidden stale aria-controlled popup", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
      <div id="queue-popup" class="slicer-dropdown-popup" style="display: none">
        <div class="slicerContainer isMultiSelectEnabled">
          <div class="searchHeader show"><input class="searchInput" value="old query" /></div>
          <div role="listbox" aria-label="queue_internal">
            <div role="option" aria-selected="false" title="Stale 1"></div>
            <div role="option" aria-selected="false" title="Stale 2"></div>
          </div>
        </div>
      </div>
    `;
    let opened = false;
    const selectedTitles = new Set<string>();
    document.querySelector<HTMLElement>('[role="combobox"]')!.addEventListener("click", () => {
      opened = true;
      document.querySelector("#queue-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="queue-popup" class="slicer-dropdown-popup">
          <div class="slicerContainer isMultiSelectEnabled">
            <div role="listbox" aria-label="queue_internal">
              <div role="option" aria-selected="false" title="Alpha"></div>
              <div role="option" aria-selected="false" title="Target"></div>
            </div>
          </div>
        </div>`
      );
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('#queue-popup [role="option"]');
      const label = option?.getAttribute("title");
      if (!option || !label) {
        return;
      }
      if (selectedTitles.has(label)) {
        selectedTitles.delete(label);
      } else {
        selectedTitles.add(label);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(label));
    });

    await expect(createAdapter(document).applyListFilterSelection("Queue", ["Target"])).resolves.toMatchObject({
      status: "applied"
    });
    expect(opened).toBe(true);
    expect(selectedTitles).toEqual(new Set(["Target"]));
  });

  it("never rediscovers or mutates a hidden stale title-matched popup while applying through a visible popup", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="Queue"></div>
      </div></section></main>
      <div id="stale-popup" class="slicer-dropdown-popup" style="display: none">
        <div class="slicerContainer isMultiSelectEnabled">
          <div role="listbox" aria-label="Queue">
            <div role="option" aria-selected="false" title="Stale only"></div>
          </div>
        </div>
      </div>
    `;
    const staleOption = document.querySelector<HTMLElement>('#stale-popup [role="option"]')!;
    let staleClicks = 0;
    let liveOptions: HTMLElement[] = [];
    staleOption.addEventListener("click", () => {
      staleClicks += 1;
      setRenderedSlicerOptionSelected(staleOption, true);
    });
    document.querySelector<HTMLElement>('[role="combobox"]')!.addEventListener("click", () => {
      if (document.querySelector("#live-popup")) {
        return;
      }
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="live-popup" class="slicer-dropdown-popup">
          <div class="slicerContainer isMultiSelectEnabled">
            <div role="listbox" aria-label="Queue">
              <div role="option" aria-selected="false" title="Live value"></div>
              <div role="option" aria-selected="false" title="Other live value"></div>
            </div>
          </div>
        </div>`
      );
      liveOptions = Array.from(document.querySelectorAll<HTMLElement>('#live-popup [role="option"]'));
      liveOptions.forEach((option) => {
        option.addEventListener("click", () => {
          setRenderedSlicerOptionSelected(option, option.getAttribute("aria-selected") !== "true");
        });
      });
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Queue", ["Stale only"])).resolves.toEqual({
      title: "Queue",
      status: "missing_value",
      message: "Missing values: Stale only."
    });
    expect(staleClicks).toBe(0);
    expect(staleOption.getAttribute("aria-selected")).toBe("false");

    const liveOption = liveOptions[0];
    await expect(adapter.applyListFilterSelection("Queue", ["Live value"])).resolves.toEqual({
      title: "Queue",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(staleClicks).toBe(0);
    expect(staleOption.getAttribute("aria-selected")).toBe("false");
    expect(liveOption.getAttribute("aria-selected")).toBe("true");

    await expect(adapter.applyListFilterSelection("Queue", [], "all")).resolves.toMatchObject({ status: "applied" });
    expect(staleClicks).toBe(0);
    expect(staleOption.getAttribute("aria-selected")).toBe("false");
    expect(liveOptions.map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "true"]);
  });

  it("starts a fresh apply scan after searched rows time out and later materialize", async () => {
    document.body.innerHTML = `
      <main><section class="visual customPadding visual-slicer"><div class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Queue" title="Queue">Queue</h3>
        <div role="combobox" aria-label="queue_internal" aria-controls="queue-popup"></div>
      </div></section></main>
    `;
    const selectedTitles = new Set(["Projected"]);
    const renderOption = (title: string) =>
      `<div role="option" aria-selected="${selectedTitles.has(title)}" title="${title}"></div>`;
    let searchQuery = "tar";
    let rowsMaterialized = false;
    let inputEvents = 0;
    const closePopup = () => document.querySelector("#queue-popup")?.remove();
    const renderPopup = () => {
      const rows = searchQuery.length > 0 || !rowsMaterialized
        ? renderOption("Projected")
        : `${renderOption("Projected")}${renderOption("Target")}`;
      const loading = searchQuery.length === 0 && !rowsMaterialized;
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="queue-popup" class="slicer-dropdown-popup">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="searchHeader show"><input class="searchInput" /></div>
            <div role="listbox" aria-label="queue_internal">${rows}</div>
          </div>
          <div class="slicer-dropdown-loader" style="display: ${loading ? "block" : "none"}"></div>
        </div>`
      );
      const input = document.querySelector<HTMLInputElement>("#queue-popup input.searchInput")!;
      input.value = searchQuery;
      input.addEventListener("input", () => {
        inputEvents += 1;
        searchQuery = input.value;
        if (!rowsMaterialized) {
          document.querySelector('#queue-popup [role="listbox"]')!.innerHTML = "";
          (document.querySelector("#queue-popup .slicer-dropdown-loader") as HTMLElement).style.display = "block";
        }
      });
    };
    document.querySelector<HTMLElement>('[role="combobox"]')!.addEventListener("click", () => {
      if (!document.querySelector("#queue-popup")) {
        renderPopup();
      }
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('#queue-popup [role="option"]');
      const label = option?.getAttribute("title");
      if (!option || !label) {
        return;
      }
      if (selectedTitles.has(label)) {
        selectedTitles.delete(label);
      } else {
        selectedTitles.add(label);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(label));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Queue", ["Target"])).resolves.toMatchObject({ status: "timeout" });
    expect(selectedTitles).toEqual(new Set(["Projected"]));
    rowsMaterialized = true;

    await expect(adapter.applyListFilterSelection("Queue", ["Target"])).resolves.toMatchObject({ status: "applied" });
    expect(inputEvents).toBe(1);
    expect(selectedTitles).toEqual(new Set(["Target"]));
  });

  it("discovers dropdown options appended outside a narrow adapter root on first apply", async () => {
    document.body.innerHTML = `
      <main>
        <div id="narrow-root">
          <section class="visual customPadding visual-slicer">
            <div class="slicer-container">
              <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
              <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
                <div class="slicer-restatement">All</div>
              </div>
            </div>
          </section>
        </div>
      </main>
    `;
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]');
    combobox?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${renderOption("ops")}
            ${renderOption("rating")}
          </div>
        </div>`
      );
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }
      const title = option?.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const narrowRoot = document.querySelector<HTMLElement>("#narrow-root");
    expect(narrowRoot).not.toBeNull();
    const adapter = createAdapter(narrowRoot!);

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["rating"] }
    ]);
  });

  it("clears initially selected dropdown slicer values that are not in the saved labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["коммуникации", "обучение", "рейтинг"]);
    const labels = ["коммуникации", "обучение", "рейтинг", "поддержка"];
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const renderPopup = () => {
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${labels.map(renderOption).join("")}
          </div>
        </div>`
      );
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      renderPopup();
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      renderPopup();
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["коммуникации", "рейтинг"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 2 values."
    });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["коммуникации", "рейтинг"] }
    ]);
  });

  it("clears selected class from external dropdown slicer option checkboxes omitted from saved labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
      <div class="slicer-dropdown-popup visual themeableElement focused">
        <div class="slicerBody" role="listbox" aria-label="Product">
          <div class="slicerItemContainer slicerCheckbox selected" role="option" aria-selected="true" title="коммуникации">
            <span class="slicerText">коммуникации</span>
          </div>
          <div class="slicerItemContainer slicerCheckbox selected" role="option" aria-selected="true" title="обучение">
            <span class="slicerText">обучение</span>
          </div>
          <div class="slicerItemContainer slicerCheckbox selected" role="option" aria-selected="true" title="рейтинг">
            <span class="slicerText">рейтинг</span>
          </div>
        </div>
      </div>
    `;
    addSlicerOptionClickHandler();
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["коммуникации", "рейтинг"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 2 values."
    });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["коммуникации", "рейтинг"] }
    ]);
    const removedOption = document.querySelector<HTMLElement>('[role="option"][title="обучение"]');
    expect(removedOption?.getAttribute("aria-selected")).toBe("false");
    expect(removedOption?.classList.contains("selected")).toBe(false);
  });

  it("clears selected class from omitted slicer options when Power BI marks the option itself selected", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicerBody" role="listbox" aria-label="Product">
              <div class="slicerItemContainer" role="option" aria-selected="true" title="коммуникации">
                <div class="slicerCheckbox"></div>
                <span class="slicerText">коммуникации</span>
              </div>
              <div class="slicerItemContainer selected" role="option" aria-selected="true" title="обучение">
                <div class="slicerCheckbox"></div>
                <span class="slicerText">обучение</span>
              </div>
              <div class="slicerItemContainer" role="option" aria-selected="true" title="рейтинг">
                <div class="slicerCheckbox"></div>
                <span class="slicerText">рейтинг</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
    addSlicerOptionClickHandler();
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["коммуникации", "рейтинг"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 2 values."
    });

    const removedOption = document.querySelector<HTMLElement>('[role="option"][title="обучение"]');
    expect(removedOption?.getAttribute("aria-selected")).toBe("false");
    expect(removedOption?.classList.contains("selected")).toBe(false);
  });

  it("waits for delayed dropdown slicer options before applying saved labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    let delayedOptionsTimer = 0;
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      delayedOptionsTimer = setTestTimeout(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div class="slicer-dropdown-popup visual themeableElement focused">
            <div class="slicerBody" role="listbox" aria-label="Product">
              ${renderOption("ops")}
              ${renderOption("rating")}
            </div>
          </div>`
        );
      }, 75);
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    try {
      await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
        title: "Product",
        status: "applied",
        message: "Applied 1 value."
      });
    } finally {
      window.clearTimeout(delayedOptionsTimer);
    }

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["rating"] }
    ]);
  });

  it("waits for slow Power BI dropdown options that appear after the first apply scan window", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    let delayedOptionsTimer = 0;
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      delayedOptionsTimer = setTestTimeout(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div class="slicer-dropdown-popup visual themeableElement focused">
            <div class="slicerBody" role="listbox" aria-label="Product">
              ${renderOption("ops")}
              ${renderOption("rating")}
            </div>
          </div>`
        );
      }, 650);
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document, { realTime: true });

    try {
      await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
        title: "Product",
        status: "applied",
        message: "Applied 1 value."
      });
    } finally {
      window.clearTimeout(delayedOptionsTimer);
    }

    expect(selectedTitles).toEqual(new Set(["rating"]));
  });

  it("opens dropdown slicers with mouse events when the combobox click method is unavailable", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]');
    expect(combobox).not.toBeNull();
    Object.defineProperty(combobox, "click", { configurable: true, value: undefined });
    combobox!.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${renderOption("ops")}
            ${renderOption("rating")}
          </div>
        </div>`
      );
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(selectedTitles).toEqual(new Set(["rating"]));
  });

  it("does not open already-clear dropdown slicers when saved labels are empty", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    let opened = false;
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      opened = true;
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            <div class="slicerItemContainer" role="option" aria-selected="false" title="rating">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">rating</span>
            </div>
          </div>
        </div>`
      );
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", [])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 0 values."
    });
    expect(opened).toBe(false);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("opens dropdown slicers with mouse events when native click alone does not open Power BI menus", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("mousedown", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${renderOption("ops")}
            ${renderOption("rating")}
          </div>
        </div>`
      );
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(selectedTitles).toEqual(new Set(["rating"]));
  });

  it("uses native click for visible slicer options after opening Power BI dropdowns with mouse events", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const renderPopup = () => {
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${renderOption("ops")}
            ${renderOption("rating")}
          </div>
        </div>`
      );

      for (const option of Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))) {
        option.click = () => {
          const title = option.getAttribute("title");
          if (!title) {
            return;
          }
          if (selectedTitles.has(title)) {
            selectedTitles.delete(title);
          } else {
            selectedTitles.add(title);
          }
          setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
        };
      }
    };
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("mousedown", renderPopup);
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(selectedTitles).toEqual(new Set(["rating"]));
  });

  it("waits for real dropdown values after Power BI first renders only Select all", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set<string>();
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("mousedown", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${renderOption("Select all")}
          </div>
        </div>`
      );

      setTestTimeout(() => {
        const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Product"]');
        if (listbox) {
          listbox.innerHTML = [renderOption("Select all"), renderOption("ops"), renderOption("rating")].join("");
        }
      }, 120);
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title || title === "Select all") {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(selectedTitles).toEqual(new Set(["rating"]));
  });

  it("keeps waiting when Power BI leaves the dropdown in Select all-only state for more than 1.5 seconds", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set<string>();
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("mousedown", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${renderOption("Select all")}
          </div>
        </div>`
      );

      setTestTimeout(() => {
        const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Product"]');
        if (listbox) {
          listbox.innerHTML = [renderOption("Select all"), renderOption("ops"), renderOption("rating")].join("");
        }
      }, 2200);
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title || title === "Select all") {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    const adapter = createAdapter(document, { realTime: true });

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(selectedTitles).toEqual(new Set(["rating"]));
  });

  it("ignores non-slicer external listboxes with matching titles while applying dropdown slicers", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
        <section class="visual customPadding visual-lineChart">
          <div class="legend flex-row" role="region" aria-label="Legend Product">
            <div class="legend-item-container" role="listbox" aria-label="Product">
              <div class="legend-item" role="option" aria-selected="false" aria-label="ops">opsops</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerContainer isMultiSelectEnabled">
            <div class="slicerBody" role="listbox" aria-label="Product">
              ${renderOption("Alles auswählen")}
              ${renderOption("ops")}
              ${renderOption("rating")}
            </div>
          </div>
        </div>`
      );
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option || option.classList.contains("legend-item")) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(selectedTitles).toEqual(new Set(["rating"]));
  });

  it("scrolls virtualized dropdown slicer options while applying saved labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["beta"]);
    const labels = ["alpha", "beta", "gamma", "delta"];
    const rowHeight = 20;
    const visibleRows = 2;
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const visibleLabelsFor = (scrollTop: number) => {
      const start = Math.min(labels.length - visibleRows, Math.floor(scrollTop / rowHeight));
      return labels.slice(start, start + visibleRows);
    };
    const renderVisibleOptions = (listbox: HTMLElement) => {
      listbox.innerHTML = visibleLabelsFor(listbox.scrollTop).map(renderOption).join("");
    };
    const attachVirtualScrollMetrics = (listbox: HTMLElement) => {
      Object.defineProperty(listbox, "clientHeight", { configurable: true, value: rowHeight * visibleRows });
      Object.defineProperty(listbox, "scrollHeight", { configurable: true, value: rowHeight * labels.length });
    };
    const renderPopup = (scrollTop = 0) => {
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product"></div>
        </div>`
      );
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Product"]');
      expect(listbox).not.toBeNull();
      attachVirtualScrollMetrics(listbox!);
      listbox!.scrollTop = scrollTop;
      renderVisibleOptions(listbox!);
      listbox!.addEventListener("scroll", () => renderVisibleOptions(listbox!));
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      renderPopup();
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      const listbox = option.closest<HTMLElement>('[role="listbox"]');
      if (listbox) {
        renderVisibleOptions(listbox);
      }
    });
    addSlicerOptionClickHandler();
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["delta"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });

    expect(selectedTitles).toEqual(new Set(["delta"]));
  });

  it("scrolls virtualized dropdown slicer viewports while applying saved labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["beta"]);
    const labels = ["alpha", "beta", "gamma", "delta"];
    const rowHeight = 20;
    const visibleRows = 2;
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const visibleLabelsFor = (scrollTop: number) => {
      const start = Math.min(labels.length - visibleRows, Math.floor(scrollTop / rowHeight));
      return labels.slice(start, start + visibleRows);
    };
    const renderVisibleOptions = (viewport: HTMLElement) => {
      const listbox = viewport.querySelector<HTMLElement>('[role="listbox"]');
      expect(listbox).not.toBeNull();
      listbox!.innerHTML = visibleLabelsFor(viewport.scrollTop).map(renderOption).join("");
    };
    const attachVirtualScrollMetrics = (viewport: HTMLElement) => {
      Object.defineProperty(viewport, "clientHeight", { configurable: true, value: rowHeight * visibleRows });
      Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: rowHeight * labels.length });
    };
    const renderPopup = (scrollTop = 0) => {
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicer-viewport">
            <div class="slicerBody" role="listbox" aria-label="Product"></div>
          </div>
        </div>`
      );
      const viewport = document.querySelector<HTMLElement>(".slicer-viewport");
      expect(viewport).not.toBeNull();
      attachVirtualScrollMetrics(viewport!);
      viewport!.scrollTop = scrollTop;
      renderVisibleOptions(viewport!);
      viewport!.addEventListener("scroll", () => renderVisibleOptions(viewport!));
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      renderPopup();
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      const viewport = option.closest<HTMLElement>(".slicer-viewport");
      if (viewport) {
        renderVisibleOptions(viewport);
      }
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["delta"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });

    expect(selectedTitles).toEqual(new Set(["delta"]));
  });

  it("re-queries the live dropdown listbox after virtualization replaces it while scrolling", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["beta"]);
    const labels = ["alpha", "beta", "gamma", "delta"];
    const rowHeight = 20;
    const visibleRows = 2;
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const visibleLabelsFor = (scrollTop: number) => {
      const start = Math.min(labels.length - visibleRows, Math.floor(scrollTop / rowHeight));
      return labels.slice(start, start + visibleRows);
    };
    const attachVirtualScrollMetrics = (element: HTMLElement) => {
      Object.defineProperty(element, "clientHeight", { configurable: true, value: rowHeight * visibleRows });
      Object.defineProperty(element, "scrollHeight", { configurable: true, value: rowHeight * labels.length });
    };
    let replacedWhileScrolling = false;
    const renderPopup = (scrollTop = 0) => {
      document.querySelector(".slicer-dropdown-popup")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${visibleLabelsFor(scrollTop).map(renderOption).join("")}
          </div>
        </div>`
      );
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Product"]');
      expect(listbox).not.toBeNull();
      attachVirtualScrollMetrics(listbox!);
      listbox!.scrollTop = scrollTop;
      listbox!.addEventListener("scroll", () => {
        if (listbox!.scrollTop > 0 && !replacedWhileScrolling) {
          replacedWhileScrolling = true;
          renderPopup(listbox!.scrollTop);
          return;
        }

        listbox!.innerHTML = visibleLabelsFor(listbox!.scrollTop).map(renderOption).join("");
      });
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      renderPopup();
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option || !option.isConnected) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      const listbox = option.closest<HTMLElement>('[role="listbox"]');
      renderPopup(listbox?.scrollTop ?? 0);
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["delta"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });

    expect(selectedTitles).toEqual(new Set(["delta"]));
    expect(replacedWhileScrolling).toBe(true);
  });

  it("drags Power BI custom scrollbar thumbs when dropdowns do not expose DOM scroll metrics", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["value-001"]);
    const labels = Array.from({ length: 20 }, (_value, index) => `value-${String(index + 1).padStart(3, "0")}`);
    const visibleRows = 8;
    let topIndex = 0;
    let dragging = false;
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const visibleLabels = () => labels.slice(topIndex, topIndex + visibleRows);
    const setRect = (element: HTMLElement, rect: { x: number; y: number; width: number; height: number }) => {
      element.getBoundingClientRect = () =>
        ({
          ...rect,
          top: rect.y,
          left: rect.x,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
          toJSON: () => rect
        }) as DOMRect;
    };
    const attachRects = () => {
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Product"]');
      const scrollbar = document.querySelector<HTMLElement>(".scroll-element.scroll-y .scroll-bar");
      const track = document.querySelector<HTMLElement>(".scroll-element.scroll-y .scroll-element_track");
      expect(listbox).not.toBeNull();
      expect(scrollbar).not.toBeNull();
      expect(track).not.toBeNull();
      setRect(listbox!, { x: 100, y: 100, width: 240, height: 160 });
      setRect(track!, { x: 332, y: 100, width: 8, height: 160 });
      setRect(scrollbar!, { x: 332, y: 100 + topIndex * 4, width: 8, height: 20 });
    };
    const renderVisibleOptions = () => {
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Product"]');
      if (listbox) {
        listbox.innerHTML = visibleLabels().map(renderOption).join("");
      }
      attachRects();
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="scroll-wrapper scrollbar-inner">
            <div class="scrollbar-inner scroll-content scroll-scrolly_visible">
              <div class="scrollRegion">
                <div class="visibleGroup">
                  <div class="slicerBody" role="listbox" aria-label="Product"></div>
                </div>
              </div>
            </div>
            <div class="scroll-element scroll-y scroll-scrolly_visible">
              <div class="scroll-element_outer">
                <div class="scroll-element_size"></div>
                <div class="scroll-element_track"></div>
                <div class="scroll-bar" style="height: 20px; top: 0px;"></div>
              </div>
            </div>
          </div>
        </div>`
      );
      renderVisibleOptions();
    });
    addDocumentListener("mousedown", (event) => {
      if ((event.target as Element).closest(".scroll-bar")) {
        dragging = true;
      }
    });
    addDocumentListener("mousemove", (event) => {
      if (!dragging) {
        return;
      }
      const nextTopIndex = Math.min(
        labels.length - visibleRows,
        Math.max(0, Math.round((((event as MouseEvent).clientY - 100) / 160) * (labels.length - visibleRows)))
      );
      if (nextTopIndex !== topIndex) {
        topIndex = nextTopIndex;
        renderVisibleOptions();
      }
    });
    addDocumentListener("mouseup", () => {
      dragging = false;
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["value-020"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(selectedTitles).toEqual(new Set(["value-020"]));
  });

  it("reports timeout instead of missing values when a virtualized dropdown exceeds the scan budget", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const selectedTitles = new Set(["value-001"]);
    const labels = Array.from({ length: 500 }, (_value, index) => `value-${String(index + 1).padStart(3, "0")}`);
    const rowHeight = 20;
    const visibleRows = 2;
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const visibleLabelsFor = (scrollTop: number) => {
      const start = Math.min(labels.length - visibleRows, Math.floor(scrollTop / rowHeight));
      return labels.slice(start, start + visibleRows);
    };
    const renderVisibleOptions = (listbox: HTMLElement) => {
      listbox.innerHTML = visibleLabelsFor(listbox.scrollTop).map(renderOption).join("");
    };
    const attachVirtualScrollMetrics = (listbox: HTMLElement) => {
      Object.defineProperty(listbox, "clientHeight", { configurable: true, value: rowHeight * visibleRows });
      Object.defineProperty(listbox, "scrollHeight", { configurable: true, value: rowHeight * labels.length });
    };
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    document.querySelector<HTMLElement>('[role="combobox"]')?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product"></div>
        </div>`
      );
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Product"]');
      expect(listbox).not.toBeNull();
      attachVirtualScrollMetrics(listbox!);
      listbox!.scrollTop = 0;
      renderVisibleOptions(listbox!);
      listbox!.addEventListener("scroll", () => renderVisibleOptions(listbox!));
    });
    addSlicerOptionClickHandler();
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["value-499"])).resolves.toEqual({
      title: "Product",
      status: "timeout",
      message: "Timed out while scanning dropdown values."
    });
    expect(selectedTitles).toEqual(new Set(["value-001"]));
  });

  it("closes dropdown slicer popups opened while applying saved labels", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]');
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    combobox?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            <div class="slicerItemContainer" role="option" aria-selected="true" title="ops">
              <div class="slicerCheckbox selected"></div>
              <span class="slicerText">ops</span>
            </div>
            <div class="slicerItemContainer" role="option" aria-selected="false" title="rating">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">rating</span>
            </div>
          </div>
        </div>`
      );
    });
    addSlicerOptionClickHandler();
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["rating"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("closes dropdown slicer popups opened while applying when saved labels are missing", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Product" title="Product">Product</h3>
            <div class="slicer-dropdown-menu" role="combobox" aria-label="Product">
              <div class="slicer-restatement">All</div>
            </div>
          </div>
        </section>
      </main>
    `;
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]');
    const selectedTitles = new Set(["ops"]);
    const renderOption = (title: string) => `
      <div class="slicerItemContainer" role="option" aria-selected="${selectedTitles.has(title)}" title="${title}">
        <div class="slicerCheckbox${selectedTitles.has(title) ? " selected" : ""}"></div>
        <span class="slicerText">${title}</span>
      </div>`;
    const closePopup = () => document.querySelector(".slicer-dropdown-popup")?.remove();
    combobox?.addEventListener("click", () => {
      if (document.querySelector(".slicer-dropdown-popup")) {
        closePopup();
        return;
      }

      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Product">
            ${renderOption("ops")}
            ${renderOption("rating")}
          </div>
        </div>`
      );
    });
    addDocumentListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
      if (!option) {
        return;
      }

      const title = option.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
      setRenderedSlicerOptionSelected(option, selectedTitles.has(title));
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["rating", "alerts"])).resolves.toEqual({
      title: "Product",
      status: "missing_value",
      message: "Missing values: alerts."
    });
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
    expect(selectedTitles).toEqual(new Set(["ops"]));
  });

  it("applies saved labels when a dropdown popup is already open and the combobox is replaced by search UI", async () => {
    document.body.innerHTML = `
      <main>
        <section class="visual customPadding visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" aria-label="Продукт" title="Продукт">Продукт</h3>
            <div class="slicer-content-wrapper">
              <input type="search" placeholder="Search" aria-label="Search" />
            </div>
          </div>
        </section>
        <div class="slicer-dropdown-popup visual themeableElement focused">
          <div class="slicerBody" role="listbox" aria-label="Продукт">
            <div class="slicerItemContainer" role="option" aria-selected="false" title="Select all">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">Select all</span>
            </div>
            <div class="slicerItemContainer" role="option" aria-selected="false" title="коммуникации">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">коммуникации</span>
            </div>
            <div class="slicerItemContainer" role="option" aria-selected="false" title="обучение">
              <div class="slicerCheckbox"></div>
              <span class="slicerText">обучение</span>
            </div>
          </div>
        </div>
      </main>
    `;
    addSlicerOptionClickHandler();
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Продукт", ["коммуникации", "обучение"])).resolves.toEqual({
      title: "Продукт",
      status: "applied",
      message: "Applied 2 values."
    });

    const selectedOptions = Array.from(document.querySelectorAll<HTMLElement>('[role="option"][aria-selected="true"]')).map(
      (option) => option.getAttribute("title")
    );
    expect(selectedOptions).toEqual(["коммуникации", "обучение"]);
  });

  it("reports missing filters", async () => {
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Country", ["Brazil"])).resolves.toEqual({
      title: "Country",
      status: "missing_filter",
      message: "Filter was not found."
    });
  });

  it("reports missing checkbox values without changing existing selections", async () => {
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Region", ["Brazil"])).resolves.toEqual({
      title: "Region",
      status: "missing_value",
      message: "Missing values: Brazil."
    });

    const filters = await adapter.readListFilters();
    expect(filters[0]).toEqual({
      title: "Region",
      type: "list",
      selectedLabels: ["EMEA", "Americas"]
    });
  });

  it("reports ambiguous filters", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<article class="filter-card" data-powerbi-filter="list">
        <h3 class="filter-title">Region</h3>
        <label><input type="checkbox" /> EMEA</label>
      </article>`
    );
    const adapter = createAdapter(document);

    await expect(adapter.applyListFilterSelection("Region", ["EMEA"])).resolves.toEqual({
      title: "Region",
      status: "ambiguous_filter",
      message: "More than one filter matched this title."
    });
  });

  it("waits for list filters to appear", async () => {
    document.body.innerHTML = "<main></main>";
    const adapter = createAdapter(document);
    const waitPromise = adapter.waitForFilterControls({ timeoutMs: 200, intervalMs: 10 });

    document.body.innerHTML = fixture;

    await expect(waitPromise).resolves.toBe(true);
  });

  it("waits for Power BI slicer controls to appear", async () => {
    document.body.innerHTML = "<main></main>";
    const adapter = createAdapter(document);
    const waitPromise = adapter.waitForFilterControls({ timeoutMs: 200, intervalMs: 10 });

    document.body.innerHTML = `
      <main>
        <section class="visual visual-slicer">
          <div class="slicer-container">
            <h3 class="slicer-header-text" title="Product">Product</h3>
            <div class="slicerBody" role="listbox" aria-label="Product">
              <div class="slicerItemContainer" role="option" aria-selected="true" title="BI">
                <span class="slicerText">BI</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;

    await expect(waitPromise).resolves.toBe(true);
  });

  it("returns false when filters do not appear before timeout", async () => {
    document.body.innerHTML = "<main></main>";
    const adapter = createAdapter(document);

    await expect(adapter.waitForFilterControls({ timeoutMs: 1, intervalMs: 1 })).resolves.toBe(false);
  });
});
