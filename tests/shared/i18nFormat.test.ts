import { afterEach, describe, expect, it } from "vitest";
import { formatPageStatus, formatSelectedFilterCount } from "../../src/shared/i18n/format";
import { installTestMessages, resetTestMessages } from "../../src/shared/i18n/messages";

describe("i18n format helpers", () => {
  afterEach(() => {
    resetTestMessages();
  });

  it("formats page status and selection guidance from substitutions", () => {
    installTestMessages({
      pageStatusWithPresetCountSingular: "$1 preset for this URL",
      pageStatusWithPresetCountPlural: "$1 presets for this URL",
      saveReviewSelectionCountSingular: "$1 of $2 filter selected",
      saveReviewSelectionCountPlural: "$1 of $2 filters selected"
    });

    expect(formatPageStatus(1)).toBe("1 preset for this URL");
    expect(formatPageStatus(2)).toBe("2 presets for this URL");
    expect(formatSelectedFilterCount(1, 1)).toBe("1 of 1 filter selected");
    expect(formatSelectedFilterCount(1, 3)).toBe("1 of 3 filters selected");
  });
});
