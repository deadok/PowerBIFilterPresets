import { describe, expect, it } from "vitest";
import { summarizeResults } from "../../src/shared/resultSummary";
import type { FilterOperationResult } from "../../src/shared/types";

describe("summarizeResults", () => {
  it("summarizes applied filters", () => {
    const results: FilterOperationResult[] = [
      { title: "Region", status: "applied", message: "Applied 2 values." },
      { title: "Product", status: "applied", message: "Applied 1 value." }
    ];

    expect(summarizeResults(results)).toBe("Applied 2 filters.");
  });

  it("includes warnings for partial success", () => {
    const results: FilterOperationResult[] = [
      { title: "Region", status: "applied", message: "Applied 2 values." },
      { title: "Country", status: "missing_value", message: "Value Brazil was not found." }
    ];

    expect(summarizeResults(results)).toBe("Applied 1 filter. 1 filter needs attention.");
  });

  it("handles empty result sets", () => {
    expect(summarizeResults([])).toBe("No supported list filters found.");
  });

  it("uses correct grammar for multiple warnings", () => {
    const results: FilterOperationResult[] = [
      { title: "Region", status: "missing_filter", message: "Filter was not found." },
      { title: "Country", status: "missing_value", message: "Value Brazil was not found." }
    ];

    expect(summarizeResults(results)).toBe("Applied 0 filters. 2 filters need attention.");
  });
});
