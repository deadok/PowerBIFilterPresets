import type { FilterPresetItem } from "../shared/types";

export type ReviewDraftFilter = {
  capturedIndex: number;
  filter: FilterPresetItem;
  included: boolean;
  expanded: boolean;
};

export type ReviewDraft = {
  filters: ReviewDraftFilter[];
};

export function createReviewDraft(capturedFilters: FilterPresetItem[]): ReviewDraft {
  return {
    filters: capturedFilters.flatMap((filter, capturedIndex) =>
      filter.selectedLabels.length > 0
        ? [{ capturedIndex, filter, included: true, expanded: false }]
        : []
    )
  };
}

function updateReviewFilter(
  draft: ReviewDraft,
  capturedIndex: number,
  update: (filter: ReviewDraftFilter) => ReviewDraftFilter
): ReviewDraft {
  const index = draft.filters.findIndex((filter) => filter.capturedIndex === capturedIndex);
  if (index === -1) {
    return draft;
  }

  return {
    filters: draft.filters.map((filter, filterIndex) => (filterIndex === index ? update(filter) : filter))
  };
}

export function setReviewFilterIncluded(
  draft: ReviewDraft,
  capturedIndex: number,
  included: boolean
): ReviewDraft {
  return updateReviewFilter(draft, capturedIndex, (filter) => ({ ...filter, included }));
}

export function setReviewFilterExpanded(
  draft: ReviewDraft,
  capturedIndex: number,
  expanded: boolean
): ReviewDraft {
  return updateReviewFilter(draft, capturedIndex, (filter) => ({ ...filter, expanded }));
}

export function selectAllReviewFilters(draft: ReviewDraft): ReviewDraft {
  return {
    filters: draft.filters.map((filter) => ({ ...filter, included: true }))
  };
}

export function clearAllReviewFilters(draft: ReviewDraft): ReviewDraft {
  return {
    filters: draft.filters.map((filter) => ({ ...filter, included: false }))
  };
}

export function projectIncludedFilters(draft: ReviewDraft): FilterPresetItem[] {
  return draft.filters
    .filter((filter) => filter.included)
    .map(({ filter }) => ({
      ...filter,
      selectedLabels: [...filter.selectedLabels]
    }));
}
