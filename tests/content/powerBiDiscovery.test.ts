import { describe, expect, it } from "vitest";
import {
  checkboxFilterCards,
  externalSlicerListboxes,
  hasAllComboboxSummary,
  hasGenericMultiSelectSummary,
  hasSlicerValueOption,
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

  it("prefers combobox aria-controls association when the snapshot header and listbox labels differ", () => {
    document.body.innerHTML = `
      <section class="slicer-container">
        <h3 class="slicer-header-text" aria-label="Приоритет">Приоритет</h3>
        <div role="combobox" aria-label="priority_display" aria-controls="priority-popup"></div>
      </section>
      <div id="priority-popup" class="slicer-dropdown-popup">
        <div id="controlled" class="slicerBody" role="listbox" aria-label="priority_display"></div>
      </div>
      <div class="slicer-dropdown-popup">
        <div id="title-match" class="slicerBody" role="listbox" aria-label="Приоритет"></div>
      </div>
    `;
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]')!;

    expect(externalSlicerListboxes(document, "Приоритет", combobox)).toEqual([
      document.querySelector("#controlled")
    ]);
  });

  it("uses logical coverage metadata without treating singleton labels, positions, or tabindex as semantics", () => {
    document.body.innerHTML = `
      <div class="isMultiSelectEnabled">
        <div id="one-row-viewport" role="listbox" aria-multiselectable="true">
          <div role="option" tabindex="0" aria-setsize="3" aria-posinset="1" data-row-id="row-1" title="Premier"></div>
        </div>
        <div id="index-fallback-viewport" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="3" data-row-index="0" data-row-id="row-1" title="Premier"></div>
        </div>
        <div id="single-en" role="listbox" aria-multiselectable="true">
          <div role="option" tabindex="0" aria-setsize="1" aria-posinset="1" data-row-id="row-1" title="Select all"></div>
        </div>
        <div id="single-fr" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="1" aria-posinset="1" data-row-id="row-1" title="Tout sélectionner"></div>
        </div>
        <div id="single-ru" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="1" aria-posinset="1" data-row-id="row-1" title="Выбрать все"></div>
        </div>
        <div id="single-real" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="1" aria-posinset="1" data-row-id="row-1" title="Only value"></div>
        </div>
        <div id="unproven" role="listbox" aria-multiselectable="true">
          <div role="option" title="Premier"></div>
        </div>
        <div id="malformed-size" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="many" aria-posinset="1" data-row-id="row-1" title="Premier"></div>
        </div>
        <div id="prefixed-size-junk" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="3junk" aria-posinset="1" data-row-id="row-1" title="Premier"></div>
        </div>
        <div id="prefixed-position-junk" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="3" aria-posinset="1junk" data-row-id="row-1" title="Premier"></div>
        </div>
        <div id="prefixed-index-junk" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="3" data-row-index="0junk" data-row-id="row-1" title="Premier"></div>
        </div>
        <div id="clean-signed-metadata" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="+3" aria-posinset="+1" data-row-id="row-1" title="Premier"></div>
        </div>
        <div id="out-of-range" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="3" aria-posinset="4" data-row-id="row-4" title="Premier"></div>
        </div>
        <div id="missing-identity" role="listbox" aria-multiselectable="true">
          <div role="option" aria-setsize="3" aria-posinset="1" title="Premier"></div>
        </div>
      </div>
    `;
    const options = (id: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`#${id} [role="option"]`));

    expect(hasSlicerValueOption(options("one-row-viewport"))).toBe(true);
    expect(hasSlicerValueOption(options("index-fallback-viewport"))).toBe(true);
    expect(hasSlicerValueOption(options("single-en"))).toBe(false);
    expect(hasSlicerValueOption(options("single-fr"))).toBe(false);
    expect(hasSlicerValueOption(options("single-ru"))).toBe(false);
    expect(hasSlicerValueOption(options("single-real"))).toBe(false);
    expect(hasSlicerValueOption(options("unproven"))).toBe(false);
    expect(hasSlicerValueOption(options("malformed-size"))).toBe(false);
    expect(hasSlicerValueOption(options("prefixed-size-junk"))).toBe(false);
    expect(hasSlicerValueOption(options("prefixed-position-junk"))).toBe(false);
    expect(hasSlicerValueOption(options("prefixed-index-junk"))).toBe(false);
    expect(hasSlicerValueOption(options("clean-signed-metadata"))).toBe(true);
    expect(hasSlicerValueOption(options("out-of-range"))).toBe(false);
    expect(hasSlicerValueOption(options("missing-identity"))).toBe(false);
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

  it("does not remove a localized first value based on multi-select position alone", () => {
    document.body.innerHTML = `
      <div id="single" role="listbox">
        <div role="option" aria-selected="true" title="Premier"></div>
      </div>
      <div class="isMultiSelectEnabled">
        <div id="multi" role="listbox">
          <div role="option" aria-selected="true" title="Tout sélectionner"></div>
          <div role="option" aria-selected="true" title="Premier"></div>
        </div>
      </div>
    `;

    expect(
      selectedLabelsFromSlicerOptions(
        Array.from(document.querySelectorAll<HTMLElement>('#single [role="option"]'))
      )
    ).toEqual(["Premier"]);
    expect(
      selectedLabelsFromSlicerOptions(
        Array.from(document.querySelectorAll<HTMLElement>('#multi [role="option"]'))
      )
    ).toEqual(["Tout sélectionner", "Premier"]);
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
