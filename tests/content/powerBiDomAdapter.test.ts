import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createPowerBiDomAdapter } from "../../src/content/powerBiDomAdapter";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(testDir, "../fixtures/powerbi-list-filters.html"), "utf8");

describe("createPowerBiDomAdapter", () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
  });

  it("reads selected values from list filters", () => {
    const adapter = createPowerBiDomAdapter(document);

    expect(adapter.readListFilters()).toEqual([
      { title: "Region", type: "list", selectedLabels: ["EMEA", "Americas"] },
      { title: "Product", type: "list", selectedLabels: ["Data Platform"] }
    ]);
  });

  it("skips unsupported filters", () => {
    const adapter = createPowerBiDomAdapter(document);

    expect(adapter.readListFilters().map((filter) => filter.title)).not.toContain("Revenue");
  });

  it("clears current selection and applies saved labels", async () => {
    const adapter = createPowerBiDomAdapter(document);

    await expect(adapter.applyListFilterSelection("Region", ["APAC"])).resolves.toEqual({
      title: "Region",
      status: "applied",
      message: "Applied 1 value."
    });

    expect(adapter.readListFilters()).toEqual([
      { title: "Region", type: "list", selectedLabels: ["APAC"] },
      { title: "Product", type: "list", selectedLabels: ["Data Platform"] }
    ]);
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

    expect(adapter.readListFilters()[0]).toEqual({
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
});
