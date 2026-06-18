import type { FilterOperationResult } from "./types";

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function needsAttention(count: number): string {
  return `${plural(count, "filter", "filters")} ${count === 1 ? "needs" : "need"} attention.`;
}

export function summarizeResults(results: FilterOperationResult[]): string {
  if (results.length === 0) {
    return "No supported list filters found.";
  }

  const successful = results.filter((result) => result.status === "applied").length;
  const attention = results.length - successful;

  if (attention === 0) {
    return `Applied ${plural(successful, "filter", "filters")}.`;
  }

  return `Applied ${plural(successful, "filter", "filters")}. ${needsAttention(attention)}`;
}
