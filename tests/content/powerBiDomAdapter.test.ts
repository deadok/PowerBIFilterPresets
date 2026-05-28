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
});
