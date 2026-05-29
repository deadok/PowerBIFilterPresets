import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPowerBiDomAdapter } from "../../src/content/powerBiDomAdapter";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(testDir, "../fixtures/powerbi-list-filters.html"), "utf8");

describe("createPowerBiDomAdapter", () => {
  let testAbortController: AbortController;
  let testTimers: number[];

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
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Region", type: "list", selectedLabels: ["EMEA", "Americas"] },
      { title: "Product", type: "list", selectedLabels: ["Data Platform"] }
    ]);
  });

  it("skips unsupported filters", async () => {
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["ops", "rating", "alerts", "education"] }
    ]);
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
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createPowerBiDomAdapter(document);

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
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.readListFilters()).resolves.toEqual([{ title: "Product", type: "list", selectedLabels: [] }]);
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("clears current selection and applies saved labels", async () => {
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["BI"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });

    await expect(adapter.readListFilters()).resolves.toEqual([
      { title: "Product", type: "list", selectedLabels: ["BI"] }
    ]);
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
      const title = option?.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createPowerBiDomAdapter(document);

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
      const title = option?.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const narrowRoot = document.querySelector<HTMLElement>("#narrow-root");
    expect(narrowRoot).not.toBeNull();
    const adapter = createPowerBiDomAdapter(narrowRoot!);

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
      const title = option?.getAttribute("title");
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
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

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
      const title = option?.getAttribute("title");
      if (!title) {
        return;
      }

      if (selectedTitles.has(title)) {
        selectedTitles.delete(title);
      } else {
        selectedTitles.add(title);
      }
    });
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createPowerBiDomAdapter(document);

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
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createPowerBiDomAdapter(document);

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
    addDocumentListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    });
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["alerts"])).resolves.toEqual({
      title: "Product",
      status: "missing_value",
      message: "Missing values: alerts."
    });
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
  });

  it("reports missing filters", async () => {
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.applyListFilterSelection("Country", ["Brazil"])).resolves.toEqual({
      title: "Country",
      status: "missing_filter",
      message: "Filter was not found."
    });
  });

  it("reports missing values without changing other filters", async () => {
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.applyListFilterSelection("Region", ["EMEA"])).resolves.toEqual({
      title: "Region",
      status: "ambiguous_filter",
      message: "More than one filter matched this title."
    });
  });

  it("waits for list filters to appear", async () => {
    document.body.innerHTML = "<main></main>";
    const adapter = createPowerBiDomAdapter(document);
    const waitPromise = adapter.waitForFilterControls({ timeoutMs: 200, intervalMs: 10 });

    document.body.innerHTML = fixture;

    await expect(waitPromise).resolves.toBe(true);
  });

  it("waits for Power BI slicer controls to appear", async () => {
    document.body.innerHTML = "<main></main>";
    const adapter = createPowerBiDomAdapter(document);
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
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.waitForFilterControls({ timeoutMs: 1, intervalMs: 1 })).resolves.toBe(false);
  });
});
