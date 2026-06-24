import { getLocale, getMessage, type MessageKey } from "./messages";

type CountKeySet = {
  one: MessageKey;
  few: MessageKey;
  many: MessageKey;
  other: MessageKey;
};

function selectCountMessage(count: number, keySet: CountKeySet, substitutions: string[]): string {
  const category = new Intl.PluralRules(getLocale()).select(count);

  switch (category) {
    case "one":
      return getMessage(keySet.one, substitutions);
    case "few":
      return getMessage(keySet.few, substitutions);
    case "many":
      return getMessage(keySet.many, substitutions);
    default:
      return getMessage(keySet.other, substitutions);
  }
}

export function formatPageStatus(count: number): string {
  return selectCountMessage(
    count,
    {
      one: "pageStatusWithPresetCountSingular",
      few: "pageStatusWithPresetCountFew",
      many: "pageStatusWithPresetCountMany",
      other: "pageStatusWithPresetCountPlural"
    },
    [String(count)]
  );
}

export function formatSelectedFilterCount(selectedCount: number, totalCount: number): string {
  return selectCountMessage(
    totalCount,
    {
      one: "saveReviewSelectionCountSingular",
      few: "saveReviewSelectionCountFew",
      many: "saveReviewSelectionCountMany",
      other: "saveReviewSelectionCountPlural"
    },
    [String(selectedCount), String(totalCount)]
  );
}

export function formatDefaultPresetName(timestamp: string): string {
  return getMessage("saveReviewDefaultName", [timestamp]);
}

export function formatSavedFilterCount(count: number): string {
  return selectCountMessage(
    count,
    {
      one: "popupSavedFilterCountSingular",
      few: "popupSavedFilterCountFew",
      many: "popupSavedFilterCountMany",
      other: "popupSavedFilterCountPlural"
    },
    [String(count)]
  );
}

export function formatReviewFilterIncludeLabel(filterTitle: string): string {
  return getMessage("saveReviewFilterIncludeLabel", [filterTitle]);
}

export function formatReviewFilterDisclosureLabel(filterTitle: string, expanded: boolean): string {
  return getMessage(expanded ? "saveReviewFilterHideValuesLabel" : "saveReviewFilterShowValuesLabel", [filterTitle]);
}

export function formatReviewFilterSelectedValueCount(count: number): string {
  return selectCountMessage(
    count,
    {
      one: "saveReviewFilterSelectedValueCountSingular",
      few: "saveReviewFilterSelectedValueCountFew",
      many: "saveReviewFilterSelectedValueCountMany",
      other: "saveReviewFilterSelectedValueCountPlural"
    },
    [String(count)]
  );
}

export function formatResultSummaryApplied(count: number): string {
  return selectCountMessage(
    count,
    {
      one: "resultSummaryAppliedSingular",
      few: "resultSummaryAppliedFew",
      many: "resultSummaryAppliedMany",
      other: "resultSummaryAppliedPlural"
    },
    [String(count)]
  );
}

export function formatResultSummaryNeedsAttention(count: number): string {
  return selectCountMessage(
    count,
    {
      one: "resultSummaryNeedsAttentionSingular",
      few: "resultSummaryNeedsAttentionFew",
      many: "resultSummaryNeedsAttentionMany",
      other: "resultSummaryNeedsAttentionPlural"
    },
    [String(count)]
  );
}

export function formatResultLogLine(title: string, message: string): string {
  return getMessage("resultLogLineTemplate", [title, message]);
}
