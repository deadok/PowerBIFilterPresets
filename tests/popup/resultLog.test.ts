import { describe, expect, it } from "vitest";
import { applyStatusSeverity, createApplyResultLines } from "../../src/popup/resultLog";
import type { FilterOperationResult } from "../../src/shared/types";

function applyResult(title: string, status: FilterOperationResult["status"], message: string): FilterOperationResult {
  return { title, status, message };
}

describe("resultLog", () => {
  it("classifies every failed apply status as an error", () => {
    expect(applyStatusSeverity("missing_filter")).toBe("error");
    expect(applyStatusSeverity("missing_value")).toBe("error");
    expect(applyStatusSeverity("ambiguous_filter")).toBe("error");
    expect(applyStatusSeverity("timeout")).toBe("error");
    expect(applyStatusSeverity("interaction_failed")).toBe("error");
  });

  it("keeps applied results normal", () => {
    expect(applyStatusSeverity("applied")).toBe("normal");
  });

  it("preserves apply result order and keeps the summary separate", () => {
    const lines = createApplyResultLines([
      applyResult("Region", "applied", "Applied 2 values."),
      applyResult("Country", "missing_value", "Missing values: Brazil."),
      applyResult("Product", "applied", "Applied 1 value.")
    ]);

    expect(lines).toEqual([
      { text: "Applied 2 filters. 1 filter needs attention.", severity: "normal" },
      { text: "Region: Applied 2 values.", severity: "normal" },
      { text: "Country: Missing values: Brazil.", severity: "error" },
      { text: "Product: Applied 1 value.", severity: "normal" }
    ]);
  });
});
