import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPowerBiDomAdapter as createAdapterWithDefaults } from "../../src/content/powerBiDomAdapter";
import { createDeterministicPowerBiTiming } from "../../src/content/powerBiTiming";

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
      listbox!.addEventListener("scroll", () => renderPopup(listbox!.scrollTop), { once: true });
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
