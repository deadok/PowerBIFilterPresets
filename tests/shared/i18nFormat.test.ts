import { afterEach, describe, expect, it } from "vitest";
import { formatPageStatus, formatSelectedFilterCount } from "../../src/shared/i18n/format";
import {
  installTestLocale,
  installTestMessages,
  resetTestLocale,
  resetTestMessages
} from "../../src/shared/i18n/messages";

describe("i18n format helpers", () => {
  afterEach(() => {
    resetTestLocale();
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

  it("uses Russian plural categories for count-based messages", () => {
    installTestLocale("ru");
    installTestMessages({
      pageStatusWithPresetCountSingular: "$1 пресет для этого URL",
      pageStatusWithPresetCountFew: "$1 пресета для этого URL",
      pageStatusWithPresetCountMany: "$1 пресетов для этого URL",
      pageStatusWithPresetCountPlural: "$1 пресетов для этого URL",
      saveReviewSelectionCountSingular: "Выбран $1 из $2 фильтра",
      saveReviewSelectionCountFew: "Выбрано $1 из $2 фильтров",
      saveReviewSelectionCountMany: "Выбрано $1 из $2 фильтров",
      saveReviewSelectionCountPlural: "Выбрано $1 из $2 фильтров"
    });

    expect(formatPageStatus(1)).toBe("1 пресет для этого URL");
    expect(formatPageStatus(2)).toBe("2 пресета для этого URL");
    expect(formatPageStatus(5)).toBe("5 пресетов для этого URL");
    expect(formatPageStatus(21)).toBe("21 пресет для этого URL");
    expect(formatSelectedFilterCount(1, 1)).toBe("Выбран 1 из 1 фильтра");
    expect(formatSelectedFilterCount(1, 2)).toBe("Выбрано 1 из 2 фильтров");
    expect(formatSelectedFilterCount(1, 5)).toBe("Выбрано 1 из 5 фильтров");
  });
});
