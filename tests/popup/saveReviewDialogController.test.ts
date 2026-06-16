import { describe, expect, it, vi } from "vitest";
import { createSaveReviewDialogController } from "../../src/popup/saveReviewDialogController";
import type { FilterPresetItem, PagePresetCollection, Preset } from "../../src/shared/types";

function filter(title: string, selectedLabels: string[]): FilterPresetItem {
  return { title, type: "list", selectedLabels };
}

function preset(id: string, name: string): Preset {
  return {
    id,
    name,
    createdAt: "2026-06-09T10:00:00.000Z",
    updatedAt: "2026-06-09T10:00:00.000Z",
    filters: [filter("Region", ["EMEA"])]
  };
}

function collection(presets: Preset[]): PagePresetCollection {
  return {
    schemaVersion: 1,
    pageKey: "https://portal.example/report",
    presets
  };
}

function createFixture() {
  document.body.innerHTML = `
    <button id="save-current">Save current filters</button>
    <button id="apply-preset">Apply preset</button>
    <section id="save-review-dialog" hidden tabindex="-1">
      <input id="save-name" />
      <p id="save-name-error" hidden></p>
      <p id="save-storage-error" hidden></p>
      <div id="review-filter-list"></div>
      <p id="review-empty" hidden></p>
      <p id="review-selection-count"></p>
      <p id="review-selection-guidance"></p>
      <button id="select-all-filters">Select all</button>
      <button id="clear-all-filters">Clear all</button>
      <button id="cancel-save">Cancel</button>
      <button id="confirm-save">Save preset</button>
    </section>
  `;

  return {
    triggerButton: document.querySelector<HTMLButtonElement>("#save-current")!,
    applyButton: document.querySelector<HTMLButtonElement>("#apply-preset")!,
    dialog: document.querySelector<HTMLElement>("#save-review-dialog")!,
    nameInput: document.querySelector<HTMLInputElement>("#save-name")!,
    nameError: document.querySelector<HTMLParagraphElement>("#save-name-error")!,
    storageError: document.querySelector<HTMLParagraphElement>("#save-storage-error")!,
    reviewList: document.querySelector<HTMLDivElement>("#review-filter-list")!,
    reviewEmpty: document.querySelector<HTMLParagraphElement>("#review-empty")!,
    selectionCount: document.querySelector<HTMLParagraphElement>("#review-selection-count")!,
    selectionGuidance: document.querySelector<HTMLParagraphElement>("#review-selection-guidance")!,
    selectAllButton: document.querySelector<HTMLButtonElement>("#select-all-filters")!,
    clearAllButton: document.querySelector<HTMLButtonElement>("#clear-all-filters")!,
    cancelButton: document.querySelector<HTMLButtonElement>("#cancel-save")!,
    confirmButton: document.querySelector<HTMLButtonElement>("#confirm-save")!
  };
}

describe("createSaveReviewDialogController", () => {
  it("opens with eligible filters and supports local include/clear/select state", () => {
    const elements = createFixture();
    const controller = createSaveReviewDialogController({
      elements,
      now: () => new Date("2026-06-16T10:00:00.000Z"),
      randomUUID: () => "00000000-0000-0000-0000-000000000000",
      getCollection: vi.fn(),
      savePreset: vi.fn(),
      openDialog: () => {
        elements.dialog.hidden = false;
        return true;
      },
      closeDialog: () => {
        elements.dialog.hidden = true;
      },
      renderCollection: vi.fn(),
      renderSaved: vi.fn(),
      errorMessage: String
    });

    controller.open([filter("Region", ["EMEA"]), filter("Empty", []), filter("Team", ["North"])]);

    expect(elements.dialog.hidden).toBe(false);
    expect(elements.nameInput.value).toMatch(/^Preset /);
    expect(document.activeElement).toBe(elements.nameInput);
    expect(Array.from(elements.reviewList.querySelectorAll(".review-filter-title")).map((node) => node.textContent)).toEqual([
      "Region",
      "Team"
    ]);
    expect(elements.selectionCount.textContent).toBe("2 of 2 filters selected");

    elements.clearAllButton.click();
    expect(Array.from(elements.reviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map((input) => input.checked)).toEqual([
      false,
      false
    ]);
    expect(elements.confirmButton.disabled).toBe(true);
    expect(elements.selectionGuidance.textContent).toBe("Select at least one filter.");

    elements.selectAllButton.click();
    expect(Array.from(elements.reviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map((input) => input.checked)).toEqual([
      true,
      true
    ]);
    expect(elements.confirmButton.disabled).toBe(false);
  });

  it("saves included filters and restores local state after storage failure", async () => {
    const elements = createFixture();
    const existing = preset("one", "Existing");
    const savedCollection = collection([existing, preset("new", "New preset")]);
    const getCollection = vi.fn().mockResolvedValue(collection([existing]));
    const savePreset = vi
      .fn()
      .mockRejectedValueOnce(new Error("Storage unavailable."))
      .mockResolvedValueOnce(savedCollection);
    const renderCollection = vi.fn();
    const renderSaved = vi.fn();
    const controller = createSaveReviewDialogController({
      elements,
      now: () => new Date("2026-06-16T10:00:00.000Z"),
      randomUUID: () => "new",
      getCollection,
      savePreset,
      openDialog: () => {
        elements.dialog.hidden = false;
        return true;
      },
      closeDialog: () => {
        elements.dialog.hidden = true;
      },
      renderCollection,
      renderSaved,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error))
    });

    controller.open([filter("Region", ["EMEA"]), filter("Team", ["North"])]);
    elements.nameInput.value = "  New preset  ";
    elements.reviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.click();
    elements.confirmButton.click();

    await vi.waitFor(() => {
      expect(elements.storageError.textContent).toBe("Storage unavailable.");
    });
    expect(elements.dialog.hidden).toBe(false);
    expect(elements.nameInput.disabled).toBe(false);
    expect(elements.reviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!.checked).toBe(false);

    elements.confirmButton.click();

    await vi.waitFor(() => {
      expect(savePreset).toHaveBeenCalledTimes(2);
      expect(renderCollection).toHaveBeenCalledWith(savedCollection, "new");
      expect(renderSaved).toHaveBeenCalledWith(1);
      expect(elements.dialog.hidden).toBe(true);
    });
    expect(document.activeElement).toBe(elements.applyButton);
  });
});
