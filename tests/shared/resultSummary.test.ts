import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installTestLocale,
  installTestMessages,
  resetTestLocale,
  resetTestMessages
} from "../../src/shared/i18n/messages";
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
    resetTestLocale();
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

  it("uses Russian plural categories in result summaries", () => {
    installTestLocale("ru");
    installTestMessages(
      {
        resultSummaryAppliedSingular: "Применён $1 фильтр.",
        resultSummaryAppliedFew: "Применено $1 фильтра.",
        resultSummaryAppliedMany: "Применено $1 фильтров.",
        resultSummaryAppliedPlural: "Применено $1 фильтров.",
        resultSummaryNeedsAttentionSingular: "$1 фильтр требует внимания.",
        resultSummaryNeedsAttentionFew: "$1 фильтра требуют внимания.",
        resultSummaryNeedsAttentionMany: "$1 фильтров требуют внимания.",
        resultSummaryNeedsAttentionPlural: "$1 фильтров требуют внимания.",
        resultSummaryNoneFound: "Поддерживаемые списковые фильтры не найдены."
      } as Parameters<typeof installTestMessages>[0]
    );

    const results: FilterOperationResult[] = [
      { title: "Region", status: "applied", message: "Applied 2 values." },
      { title: "Country", status: "applied", message: "Applied 1 value." },
      { title: "Product", status: "missing_value", message: "Value was not found." },
      { title: "City", status: "missing_value", message: "Value was not found." }
    ];

    expect(summarizeResults(results)).toBe("Применено 2 фильтра. 2 фильтра требуют внимания.");
  });
});
