import { describe, expect, it } from "vitest";
import {
  checkboxFilterCards,
  externalSlicerListboxes,
  hasAllComboboxSummary,
  hasGenericMultiSelectSummary,
  labelForCheckbox,
  labelForSlicerOption,
  listFilterControls,
  selectedLabelsFromComboboxSummary,
  selectedLabelsFromSlicerOptions,
  slicerControls,
  titleForSlicer
} from "../../src/content/powerBiDiscovery";

describe("Power BI discovery helpers", () => {
  it("discovers checkbox and slicer controls with stable titles", () => {
    document.body.innerHTML = `
      <section data-powerbi-filter="list">
        <h3> Region </h3>
        <label><input type="checkbox" checked /> EMEA </label>
      </section>
      <section class="slicer-container">
        <div class="slicer-header-text" aria-label=" Product "></div>
        <div role="listbox">
          <div role="option" aria-selected="true" title="Analytics"></div>
        </div>
      </section>
      <section class="slicer-container">
        <div class="slicer-header-text"></div>
      </section>
    `;

    expect(checkboxFilterCards(document).map((control) => control.title)).toEqual(["Region"]);
    expect(slicerControls(document).map((control) => control.title)).toEqual(["Product"]);
    expect(listFilterControls(document).map((control) => `${control.kind}:${control.title}`)).toEqual([
      "checkbox:Region",
      "slicer:Product"
    ]);
  });

  it("parses labels from checkbox and slicer option variants", () => {
    document.body.innerHTML = `
      <label><input id="wrapped" type="checkbox" /> checked North </label>
      <span id="labelled"> South </span>
      <input id="by-label" type="checkbox" aria-labelledby="labelled" />
      <input id="by-aria" type="checkbox" aria-label=" West " />
      <div id="with-title" role="option" title=" Title value "></div>
      <div id="with-aria" role="option" aria-label=" Aria value "></div>
      <div id="with-text" role="option"><span class="slicerText"> Text value </span></div>
    `;

    expect(labelForCheckbox(document.querySelector<HTMLInputElement>("#wrapped")!)).toBe("North");
    expect(labelForCheckbox(document.querySelector<HTMLInputElement>("#by-label")!)).toBe("South");
    expect(labelForCheckbox(document.querySelector<HTMLInputElement>("#by-aria")!)).toBe("West");
    expect(labelForSlicerOption(document.querySelector<HTMLElement>("#with-title")!)).toBe("Title value");
    expect(labelForSlicerOption(document.querySelector<HTMLElement>("#with-aria")!)).toBe("Aria value");
    expect(labelForSlicerOption(document.querySelector<HTMLElement>("#with-text")!)).toBe("Text value");
  });

  it("classifies external slicer dropdown listboxes by title and popup container", () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <div role="listbox" aria-label="Product">
          <div role="option" title="Inline"></div>
        </div>
      </section>
      <div class="slicer-dropdown-popup">
        <div id="external" role="listbox" aria-label="Product">
          <div role="option" title="External"></div>
        </div>
      </div>
      <div role="listbox" aria-label="Product">
        <div role="option" title="Unrelated"></div>
      </div>
    `;

    expect(externalSlicerListboxes(document, "Product")).toEqual([document.querySelector("#external")]);
  });

  it("keeps localized generic combobox summaries out of captured labels", () => {
    document.body.innerHTML = `
      <section class="slicer-container" id="single">
        <div role="combobox"><span class="slicer-restatement"> Power BI </span></div>
      </section>
      <section class="slicer-container" id="multiple">
        <div role="combobox"><span class="slicer-restatement"> Multiple selections </span></div>
      </section>
      <section class="slicer-container" id="localized">
        <div role="combobox"><span class="slicer-restatement"> Выбрано несколько значений </span></div>
      </section>
      <section class="slicer-container" id="all">
        <div role="combobox"><span class="slicer-restatement"> All </span></div>
      </section>
    `;
    const single = { kind: "slicer" as const, element: document.querySelector<HTMLElement>("#single")!, title: "Single" };
    const multiple = { kind: "slicer" as const, element: document.querySelector<HTMLElement>("#multiple")!, title: "Multiple" };
    const localized = { kind: "slicer" as const, element: document.querySelector<HTMLElement>("#localized")!, title: "Localized" };
    const all = { kind: "slicer" as const, element: document.querySelector<HTMLElement>("#all")!, title: "All" };

    expect(selectedLabelsFromComboboxSummary(single)).toEqual(["Power BI"]);
    expect(selectedLabelsFromComboboxSummary(multiple)).toEqual([]);
    expect(hasGenericMultiSelectSummary(localized)).toBe(true);
    expect(hasAllComboboxSummary(all)).toBe(true);
  });

  it("projects selected slicer option labels once and omits Select all", () => {
    document.body.innerHTML = `
      <div role="option" aria-selected="true" title="Select all"></div>
      <div role="option" aria-selected="true" title="North"></div>
      <div role="option" class="selected" title="North"></div>
      <div role="option"><span class="slicerCheckbox selected"></span><span class="slicerText">South</span></div>
      <div role="option" title="Hidden"></div>
    `;

    expect(selectedLabelsFromSlicerOptions(Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')))).toEqual([
      "North",
      "South"
    ]);
  });

  it("uses slicer title fallbacks in the existing order", () => {
    document.body.innerHTML = `
      <section id="header-label"><span class="slicer-header-text" aria-label=" Header label " title="Header title">Header text</span></section>
      <section id="header-title"><span class="slicer-header-text" title=" Header title ">Header text</span></section>
      <section id="listbox-label"><div role="listbox" aria-label=" Listbox label "></div></section>
      <section id="combobox-label"><div role="combobox" aria-label=" Combo label "></div></section>
    `;

    expect(titleForSlicer(document.querySelector<HTMLElement>("#header-label")!)).toBe("Header label");
    expect(titleForSlicer(document.querySelector<HTMLElement>("#header-title")!)).toBe("Header title");
    expect(titleForSlicer(document.querySelector<HTMLElement>("#listbox-label")!)).toBe("Listbox label");
    expect(titleForSlicer(document.querySelector<HTMLElement>("#combobox-label")!)).toBe("Combo label");
  });
});
