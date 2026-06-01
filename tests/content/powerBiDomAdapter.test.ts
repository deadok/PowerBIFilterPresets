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
    addSlicerOptionClickHandler();
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
    addSlicerOptionClickHandler();
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
    addSlicerOptionClickHandler();
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
    const adapter = createPowerBiDomAdapter(document);

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
    addSlicerOptionClickHandler();
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
    addSlicerOptionClickHandler();
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
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["delta"])).resolves.toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });

    expect(selectedTitles).toEqual(new Set(["delta"]));
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
    const adapter = createPowerBiDomAdapter(document);

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
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.applyListFilterSelection("Product", ["rating", "alerts"])).resolves.toEqual({
      title: "Product",
      status: "missing_value",
      message: "Missing values: alerts."
    });
    expect(document.querySelector(".slicer-dropdown-popup")).toBeNull();
    expect(selectedTitles).toEqual(new Set(["ops"]));
  });

  it("reports missing filters", async () => {
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.applyListFilterSelection("Country", ["Brazil"])).resolves.toEqual({
      title: "Country",
      status: "missing_filter",
      message: "Filter was not found."
    });
  });

  it("reports missing checkbox values without changing existing selections", async () => {
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
