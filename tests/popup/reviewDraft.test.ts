import { describe, expect, it } from "vitest";
import {
  clearAllReviewFilters,
  createReviewDraft,
  projectIncludedFilters,
  selectAllReviewFilters,
  setReviewFilterExpanded,
  setReviewFilterIncluded
} from "../../src/popup/reviewDraft";
import type { FilterPresetItem } from "../../src/shared/types";

const capturedFilters: FilterPresetItem[] = [
  { title: "Region", type: "list", selectedLabels: ["EMEA", "APAC"] },
  { title: "Empty", type: "list", selectedLabels: [] },
  { title: "Product", type: "list", selectedLabels: ["Analytics", "Platform"] },
  { title: "Team", type: "list", selectedLabels: ["Core"] },
  { title: "All products", type: "list", selectedLabels: [], selectionMode: "all" },
  { title: "No owners", type: "list", selectedLabels: [], selectionMode: "none" }
];

describe("review draft", () => {
  it("omits empty filters and initially includes and collapses every eligible filter", () => {
    const draft = createReviewDraft(capturedFilters);

    expect(draft.filters).toEqual([
      { capturedIndex: 0, filter: capturedFilters[0], included: true, expanded: false },
      { capturedIndex: 2, filter: capturedFilters[2], included: true, expanded: false },
      { capturedIndex: 3, filter: capturedFilters[3], included: true, expanded: false },
      { capturedIndex: 4, filter: capturedFilters[4], included: false, expanded: false },
      { capturedIndex: 5, filter: capturedFilters[5], included: false, expanded: false }
    ]);
  });

  it("tracks multiple expanded filters by stable captured index", () => {
    const draft = createReviewDraft(capturedFilters);
    const regionExpanded = setReviewFilterExpanded(draft, 0, true);
    const bothExpanded = setReviewFilterExpanded(regionExpanded, 2, true);

    expect(bothExpanded.filters.map(({ capturedIndex, expanded }) => ({ capturedIndex, expanded }))).toEqual([
      { capturedIndex: 0, expanded: true },
      { capturedIndex: 2, expanded: true },
      { capturedIndex: 3, expanded: false },
      { capturedIndex: 4, expanded: false },
      { capturedIndex: 5, expanded: false }
    ]);
  });

  it("keeps inclusion and expansion independent", () => {
    const draft = setReviewFilterExpanded(createReviewDraft(capturedFilters), 2, true);
    const excluded = setReviewFilterIncluded(draft, 2, false);

    expect(excluded.filters.find(({ capturedIndex }) => capturedIndex === 2)).toMatchObject({
      included: false,
      expanded: true
    });
    expect(draft.filters.find(({ capturedIndex }) => capturedIndex === 2)).toMatchObject({
      included: true,
      expanded: true
    });
  });

  it("selects and clears all eligible filters without changing expansion", () => {
    const expanded = setReviewFilterExpanded(createReviewDraft(capturedFilters), 0, true);
    const cleared = clearAllReviewFilters(expanded);
    const selected = selectAllReviewFilters(cleared);

    expect(cleared.filters.map(({ included }) => included)).toEqual([false, false, false, false, false]);
    expect(selected.filters.map(({ included }) => included)).toEqual([true, true, true, true, true]);
    expect(cleared.filters[0]?.expanded).toBe(true);
    expect(selected.filters[0]?.expanded).toBe(true);
  });

  it("projects only included filters while preserving captured filter and value order", () => {
    const draft = setReviewFilterIncluded(createReviewDraft(capturedFilters), 2, false);

    expect(projectIncludedFilters(draft)).toEqual([
      { title: "Region", type: "list", selectedLabels: ["EMEA", "APAC"] },
      { title: "Team", type: "list", selectedLabels: ["Core"] }
    ]);
  });

  it("keeps all and none captures visible but excluded until the user chooses to save them", () => {
    const draft = createReviewDraft(capturedFilters);
    expect(draft.filters.slice(-2).map(({ included }) => included)).toEqual([false, false]);

    const withAllIncluded = setReviewFilterIncluded(draft, 4, true);
    expect(projectIncludedFilters(withAllIncluded).at(-1)).toEqual({
      title: "All products",
      type: "list",
      selectedLabels: [],
      selectionMode: "all"
    });
  });

  it("does not mutate captured filters while draft state changes or projection is edited", () => {
    const original = structuredClone(capturedFilters);
    const draft = clearAllReviewFilters(setReviewFilterExpanded(createReviewDraft(capturedFilters), 0, true));
    const projected = projectIncludedFilters(selectAllReviewFilters(draft));

    projected[0]?.selectedLabels.reverse();

    expect(capturedFilters).toEqual(original);
  });

  it("leaves the draft unchanged when a captured index is not eligible", () => {
    const draft = createReviewDraft(capturedFilters);

    expect(setReviewFilterIncluded(draft, 1, false)).toBe(draft);
    expect(setReviewFilterExpanded(draft, 99, true)).toBe(draft);
  });
});
