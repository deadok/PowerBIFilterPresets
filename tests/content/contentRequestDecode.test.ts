import { describe, expect, it } from "vitest";
import { decodeContentRequest } from "../../src/content/contentRequestDecode";
import type { ApplyFiltersRequest, ReadFiltersRequest } from "../../src/shared/types";

const readRequest: ReadFiltersRequest = { type: "READ_FILTERS" };
const applyRequest: ApplyFiltersRequest = {
  type: "APPLY_FILTERS",
  filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
};

describe("decodeContentRequest", () => {
  it("decodes complete read and apply requests", () => {
    expect(decodeContentRequest(readRequest)).toEqual(readRequest);
    expect(decodeContentRequest(applyRequest)).toEqual(applyRequest);
    expect(
      decodeContentRequest({
        type: "APPLY_FILTERS",
        filters: [{ title: "Product", type: "list", selectedLabels: [], selectionMode: "all" }]
      })
    ).toEqual({
      type: "APPLY_FILTERS",
      filters: [{ title: "Product", type: "list", selectedLabels: [], selectionMode: "all" }]
    });
  });

  it.each([
    null,
    [],
    { type: "UNKNOWN" },
    { type: "READ_FILTERS", filters: [] },
    { type: "APPLY_FILTERS" },
    { type: "APPLY_FILTERS", filters: [{ title: "Region", type: "range", selectedLabels: [] }] },
    { type: "APPLY_FILTERS", filters: [{ title: "Region", type: "list", selectedLabels: [], selectionMode: "some" }] },
    { type: "APPLY_FILTERS", filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"], selectionMode: "all" }] }
  ])("rejects malformed requests", (request) => {
    expect(decodeContentRequest(request)).toBeUndefined();
  });
});
