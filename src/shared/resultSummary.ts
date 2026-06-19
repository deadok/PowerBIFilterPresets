import { formatResultSummaryApplied, formatResultSummaryNeedsAttention } from "./i18n/format";
import { getMessage } from "./i18n/messages";
import type { FilterOperationResult } from "./types";

export function summarizeResults(results: FilterOperationResult[]): string {
  if (results.length === 0) {
    return getMessage("resultSummaryNoneFound");
  }

  const successful = results.filter((result) => result.status === "applied").length;
  const attention = results.length - successful;

  if (attention === 0) {
    return formatResultSummaryApplied(successful);
  }

  return `${formatResultSummaryApplied(successful)} ${formatResultSummaryNeedsAttention(attention)}`;
}
