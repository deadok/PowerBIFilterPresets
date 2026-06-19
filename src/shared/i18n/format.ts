import { getMessage } from "./messages";

export function formatPageStatus(count: number): string {
  return getMessage(count === 1 ? "pageStatusWithPresetCountSingular" : "pageStatusWithPresetCountPlural", [
    String(count)
  ]);
}

export function formatSelectedFilterCount(selectedCount: number, totalCount: number): string {
  return getMessage(
    totalCount === 1 ? "saveReviewSelectionCountSingular" : "saveReviewSelectionCountPlural",
    [String(selectedCount), String(totalCount)]
  );
}

export function formatDefaultPresetName(timestamp: string): string {
  return getMessage("saveReviewDefaultName", [timestamp]);
}

export function formatSavedFilterCount(count: number): string {
  return getMessage(count === 1 ? "popupSavedFilterCountSingular" : "popupSavedFilterCountPlural", [String(count)]);
}

export function formatReviewFilterIncludeLabel(filterTitle: string): string {
  return getMessage("saveReviewFilterIncludeLabel", [filterTitle]);
}

export function formatReviewFilterDisclosureLabel(filterTitle: string, expanded: boolean): string {
  return getMessage(expanded ? "saveReviewFilterHideValuesLabel" : "saveReviewFilterShowValuesLabel", [filterTitle]);
}

export function formatReviewFilterSelectedValueCount(count: number): string {
  return getMessage(
    count === 1 ? "saveReviewFilterSelectedValueCountSingular" : "saveReviewFilterSelectedValueCountPlural",
    [String(count)]
  );
}

export function formatResultSummaryApplied(count: number): string {
  return getMessage(count === 1 ? "resultSummaryAppliedSingular" : "resultSummaryAppliedPlural", [String(count)]);
}

export function formatResultSummaryNeedsAttention(count: number): string {
  return getMessage(
    count === 1 ? "resultSummaryNeedsAttentionSingular" : "resultSummaryNeedsAttentionPlural",
    [String(count)]
  );
}

export function formatResultLogLine(title: string, message: string): string {
  return getMessage("resultLogLineTemplate", [title, message]);
}
