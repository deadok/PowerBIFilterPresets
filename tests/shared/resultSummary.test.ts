import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installTestMessages, resetTestMessages } from "../../src/shared/i18n/messages";
import { summarizeResults } from "../../src/shared/resultSummary";
import type { FilterOperationResult } from "../../src/shared/types";

describe("summarizeResults", () => {
  beforeEach(() => {
    installTestMessages(
      {
        resultSummaryAppliedSingular: "Applied $1 filter successfully.",
        resultSummaryAppliedPlural: "Applied $1 filters successfully.",
        resultSummaryNeedsAttentionSingular: "$1 filter needs review.",
        resultSummaryNeedsAttentionPlural: "$1 filters need review.",
        resultSummaryNoneFound: "No supported list filters were found."
      } as Parameters<typeof installTestMessages>[0]
    );
  });

  afterEach(() => {
    resetTestMessages();
  });

  it("summarizes applied filters", () => {
    const results: FilterOperationResult[] = [
      { title: "Region", status: "applied", message: "Applied 2 values." },
      { title: "Product", status: "applied", message: "Applied 1 value." }
    ];

    expect(summarizeResults(results)).toBe("Applied 2 filters successfully.");
  });

  it("includes warnings for partial success", () => {
    const results: FilterOperationResult[] = [
      { title: "Region", status: "applied", message: "Applied 2 values." },
      { title: "Country", status: "missing_value", message: "Value Brazil was not found." }
    ];

    expect(summarizeResults(results)).toBe("Applied 1 filter successfully. 1 filter needs review.");
  });

  it("handles empty result sets", () => {
    expect(summarizeResults([])).toBe("No supported list filters were found.");
  });

  it("uses correct grammar for multiple warnings", () => {
    const results: FilterOperationResult[] = [
      { title: "Region", status: "missing_filter", message: "Filter was not found." },
      { title: "Country", status: "missing_value", message: "Value Brazil was not found." }
    ];

    expect(summarizeResults(results)).toBe("Applied 0 filters successfully. 2 filters need review.");
  });
});
