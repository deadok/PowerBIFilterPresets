import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyStatusSeverity, createApplyResultLines, createResultLine, renderResult } from "../../src/popup/resultLog";
import { installTestMessages, resetTestMessages } from "../../src/shared/i18n/messages";
import type { FilterOperationResult } from "../../src/shared/types";

function applyResult(title: string, status: FilterOperationResult["status"], message: string): FilterOperationResult {
  return { title, status, message };
}

describe("resultLog", () => {
  beforeEach(() => {
    installTestMessages(
      {
        resultSummaryAppliedSingular: "Applied $1 filter successfully.",
        resultSummaryAppliedPlural: "Applied $1 filters successfully.",
        resultSummaryNeedsAttentionSingular: "$1 filter needs review.",
        resultSummaryNeedsAttentionPlural: "$1 filters need review.",
        resultSummaryNoneFound: "No supported list filters were found.",
        resultLogLineTemplate: "$1 -> $2"
      } as Parameters<typeof installTestMessages>[0]
    );
  });

  afterEach(() => {
    resetTestMessages();
  });

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
      { text: "Applied 2 filters successfully. 1 filter needs review.", severity: "normal" },
      { text: "Region -> Applied 2 values.", severity: "normal" },
      { text: "Country -> Missing values: Brazil.", severity: "error" },
      { text: "Product -> Applied 1 value.", severity: "normal" }
    ]);
  });

  it("renders apply-result text as plain text when details contain HTML-like content", () => {
    const output = document.createElement("output");

    renderResult(output, createResultLine('<b>unsafe</b>', "error"));

    expect(output.innerHTML).not.toContain("<b>");
    expect(output.textContent).toContain("<b>unsafe</b>");
  });
});
