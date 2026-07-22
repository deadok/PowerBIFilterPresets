import { describe, expect, it } from "vitest";
import { decodeContentResponse } from "../../src/popup/contentResponseDecode";
import type { ApplyFiltersRequest, ReadFiltersRequest } from "../../src/shared/types";

const readRequest: ReadFiltersRequest = { type: "READ_FILTERS" };
const applyRequest: ApplyFiltersRequest = { type: "APPLY_FILTERS", filters: [] };

describe("decodeContentResponse", () => {
  it("decodes request-specific success and shared failure responses", () => {
    expect(
      decodeContentResponse(readRequest, {
        ok: true,
        filters: [
          { title: "Region", type: "list", selectedLabels: ["EMEA"] },
          { title: "Product", type: "list", selectedLabels: [], selectionMode: "none" }
        ]
      })
    ).toEqual({
      ok: true,
      filters: [
        { title: "Region", type: "list", selectedLabels: ["EMEA"] },
        { title: "Product", type: "list", selectedLabels: [], selectionMode: "none" }
      ]
    });
    expect(
      decodeContentResponse(applyRequest, {
        ok: true,
        results: [{ title: "Region", status: "applied", message: "Applied 1 value." }]
      })
    ).toEqual({
      ok: true,
      results: [{ title: "Region", status: "applied", message: "Applied 1 value." }]
    });
    expect(decodeContentResponse(readRequest, { ok: false, error: "Capture failed." })).toEqual({
      ok: false,
      error: "Capture failed."
    });
  });

  it("rejects mismatched and malformed responses", () => {
    expect(decodeContentResponse(readRequest, { ok: true, results: [] })).toBeUndefined();
    expect(decodeContentResponse(applyRequest, { ok: true, filters: [] })).toBeUndefined();
    expect(
      decodeContentResponse(readRequest, {
        ok: true,
        filters: [{ title: "Region", type: "list", selectedLabels: [4] }]
      })
    ).toBeUndefined();
    expect(
      decodeContentResponse(applyRequest, {
        ok: true,
        results: [{ title: "Region", status: "unknown", message: "Invalid." }]
      })
    ).toBeUndefined();
    expect(
      decodeContentResponse(applyRequest, {
        ok: true,
        results: [{ title: "Region", status: "saved", message: "Saved 1 value." }]
      })
    ).toBeUndefined();
    expect(
      decodeContentResponse(applyRequest, {
        ok: true,
        results: [{ title: "Region", status: "skipped_unsupported", message: "Skipped unsupported filter." }]
      })
    ).toBeUndefined();
    expect(decodeContentResponse(readRequest, { ok: false, error: 4 })).toBeUndefined();
    expect(
      decodeContentResponse(readRequest, {
        ok: true,
        filters: [{ title: "Region", type: "list", selectedLabels: [], selectionMode: "invalid" }]
      })
    ).toBeUndefined();
    expect(
      decodeContentResponse(readRequest, {
        ok: true,
        filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"], selectionMode: "none" }]
      })
    ).toBeUndefined();
  });
});
