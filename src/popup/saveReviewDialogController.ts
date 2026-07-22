import { normalizePresetName, validatePresetName } from "./presetNameValidation";
import {
  clearAllReviewFilters,
  createReviewDraft,
  projectIncludedFilters,
  selectAllReviewFilters,
  setReviewFilterExpanded,
  setReviewFilterIncluded,
  type ReviewDraft
} from "./reviewDraft";
import {
  formatDefaultPresetName,
  formatReviewFilterDisclosureLabel,
  formatReviewFilterIncludeLabel,
  formatReviewFilterSelectedValueCount,
  formatSelectedFilterCount
} from "../shared/i18n/format";
import { getMessage } from "../shared/i18n/messages";
import type { FilterPresetItem, PagePresetCollection, Preset } from "../shared/types";

type SavePresetOptions = {
  uniqueNormalizedName: string;
};

export type SaveReviewDialogElements = {
  triggerButton: HTMLButtonElement;
  applyButton: HTMLButtonElement;
  dialog: HTMLElement;
  nameInput: HTMLInputElement;
  nameError: HTMLParagraphElement;
  storageError: HTMLParagraphElement;
  reviewList: HTMLDivElement;
  reviewEmpty: HTMLParagraphElement;
  selectionCount: HTMLParagraphElement;
  selectionGuidance: HTMLParagraphElement;
  selectAllButton: HTMLButtonElement;
  clearAllButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  confirmButton: HTMLButtonElement;
};

type SaveReviewDialogControllerOptions = {
  elements: SaveReviewDialogElements;
  now: () => Date;
  randomUUID: () => string;
  getCollection: () => Promise<PagePresetCollection>;
  savePreset: (preset: Preset, options: SavePresetOptions) => Promise<PagePresetCollection>;
  openDialog: () => boolean;
  closeDialog: () => void;
  renderCollection: (collection: PagePresetCollection, preferredSelectionId?: string) => void;
  renderSaved: (filterCount: number) => void;
  errorMessage: (error: unknown) => string;
};

export type SaveReviewDialogController = {
  open: (filters: FilterPresetItem[]) => boolean;
  close: (restoreFocus: boolean) => void;
  confirm: () => void;
  isInFlight: () => boolean;
};

function setMessage(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = message.length === 0;
}

function isPresetNameConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "PresetNameConflictError";
}

function createPreset(filters: FilterPresetItem[], name: string, options: SaveReviewDialogControllerOptions): Preset {
  const now = options.now().toISOString();
  return {
    id: options.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    filters
  };
}

export function createSaveReviewDialogController(
  options: SaveReviewDialogControllerOptions
): SaveReviewDialogController {
  const { elements } = options;
  let reviewDraft: ReviewDraft | undefined;
  let saveInFlight = false;

  function updateSelectionState(): void {
    const includedCount = reviewDraft?.filters.filter((item) => item.included).length ?? 0;
    const totalCount = reviewDraft?.filters.length ?? 0;
    elements.selectionCount.textContent = formatSelectedFilterCount(includedCount, totalCount);
    elements.selectionGuidance.textContent = includedCount === 0 ? getMessage("saveReviewSelectionGuidanceRequired") : "";
    elements.confirmButton.disabled = includedCount === 0 || saveInFlight;
    elements.selectAllButton.disabled = totalCount === 0 || saveInFlight;
    elements.clearAllButton.disabled = totalCount === 0 || saveInFlight;
  }

  function setControlsDisabled(disabled: boolean): void {
    elements.nameInput.disabled = disabled;
    for (const control of Array.from(
      elements.reviewList.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")
    )) {
      control.disabled = disabled;
    }
  }

  function renderReviewFilters(): void {
    elements.reviewList.replaceChildren();
    const filters = reviewDraft?.filters ?? [];
    elements.reviewList.hidden = filters.length === 0;
    elements.reviewEmpty.hidden = filters.length > 0;

    for (const item of filters) {
      const article = document.createElement("article");
      article.className = "review-filter";
      article.dataset.capturedIndex = String(item.capturedIndex);

      const row = document.createElement("div");
      row.className = "review-filter-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.included;
      checkbox.setAttribute("aria-label", formatReviewFilterIncludeLabel(item.filter.title));

      const disclosure = document.createElement("button");
      disclosure.type = "button";
      disclosure.className = "review-filter-disclosure";
      disclosure.setAttribute("aria-label", formatReviewFilterDisclosureLabel(item.filter.title, item.expanded));
      disclosure.setAttribute("aria-expanded", String(item.expanded));
      disclosure.setAttribute("aria-controls", `review-values-${item.capturedIndex}`);
      disclosure.innerHTML =
        '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"></path></svg>';

      const title = document.createElement("span");
      title.className = "review-filter-title";
      title.textContent = item.filter.title;

      const count = document.createElement("span");
      count.className = "review-filter-count";
      const selectionModeLabel = item.filter.selectionMode
        ? getMessage(item.filter.selectionMode === "all" ? "saveReviewFilterSelectionAll" : "saveReviewFilterSelectionNone")
        : undefined;
      count.textContent = selectionModeLabel ?? String(item.filter.selectedLabels.length);
      count.setAttribute(
        "aria-label",
        selectionModeLabel ?? formatReviewFilterSelectedValueCount(item.filter.selectedLabels.length)
      );

      const values = document.createElement("ul");
      values.id = `review-values-${item.capturedIndex}`;
      values.className = "review-filter-values";
      values.hidden = !item.expanded;
      for (const label of selectionModeLabel ? [selectionModeLabel] : item.filter.selectedLabels) {
        const value = document.createElement("li");
        value.textContent = label;
        values.append(value);
      }

      const toggleExpansion = (): void => {
        if (!reviewDraft || saveInFlight) {
          return;
        }
        const nextExpanded = disclosure.getAttribute("aria-expanded") !== "true";
        reviewDraft = setReviewFilterExpanded(reviewDraft, item.capturedIndex, nextExpanded);
        disclosure.setAttribute("aria-expanded", String(nextExpanded));
        disclosure.setAttribute("aria-label", formatReviewFilterDisclosureLabel(item.filter.title, nextExpanded));
        values.hidden = !nextExpanded;
      };

      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (!reviewDraft || saveInFlight) {
          return;
        }
        reviewDraft = setReviewFilterIncluded(reviewDraft, item.capturedIndex, checkbox.checked);
        updateSelectionState();
      });
      disclosure.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleExpansion();
      });
      row.addEventListener("click", toggleExpansion);

      row.append(checkbox, disclosure, title, count);
      article.append(row, values);
      elements.reviewList.append(article);
    }

    updateSelectionState();
  }

  function setBusy(busy: boolean): void {
    saveInFlight = busy;
    setControlsDisabled(busy);
    elements.cancelButton.disabled = busy;
    elements.confirmButton.disabled = busy || (reviewDraft?.filters.filter((item) => item.included).length ?? 0) === 0;
    if (busy) {
      elements.dialog.setAttribute("aria-busy", "true");
    } else {
      elements.dialog.removeAttribute("aria-busy");
    }
  }

  function resetDialog(restoreFocus: boolean): void {
    options.closeDialog();
    reviewDraft = undefined;
    setBusy(false);
    elements.nameInput.value = "";
    setMessage(elements.nameError, "");
    setMessage(elements.storageError, "");
    elements.cancelButton.disabled = false;
    if (restoreFocus) {
      elements.triggerButton.focus();
    }
  }

  function close(restoreFocus: boolean): void {
    if (saveInFlight) {
      return;
    }

    resetDialog(restoreFocus);
  }

  function open(filters: FilterPresetItem[]): boolean {
    reviewDraft = createReviewDraft(filters);
    elements.nameInput.value = formatDefaultPresetName(options.now().toLocaleString());
    setMessage(elements.nameError, "");
    setMessage(elements.storageError, "");
    elements.cancelButton.disabled = false;
    renderReviewFilters();
    if (!options.openDialog()) {
      reviewDraft = undefined;
      return false;
    }
    elements.nameInput.focus();
    elements.nameInput.select();
    return true;
  }

  function confirm(): void {
    if (!reviewDraft || saveInFlight) {
      return;
    }
    const includedFilters = projectIncludedFilters(reviewDraft);
    if (includedFilters.length === 0) {
      updateSelectionState();
      return;
    }

    setBusy(true);
    setMessage(elements.nameError, "");
    setMessage(elements.storageError, "");
    let focusNameAfterSubmit = false;

    void options
      .getCollection()
      .then(async (collection) => {
        const validation = validatePresetName(elements.nameInput.value, collection);
        if (!validation.valid) {
          setMessage(elements.nameError, validation.error);
          focusNameAfterSubmit = true;
          return;
        }

        const preset = createPreset(includedFilters, validation.name, options);
        const nextCollection = await options.savePreset(preset, {
          uniqueNormalizedName: normalizePresetName(validation.name)
        });
        options.renderCollection(nextCollection, preset.id);
        resetDialog(false);
        options.renderSaved(includedFilters.length);
        elements.applyButton.focus();
      })
      .catch((error: unknown) => {
        if (isPresetNameConflict(error)) {
          setMessage(elements.nameError, options.errorMessage(error));
          focusNameAfterSubmit = true;
        } else {
          setMessage(elements.storageError, options.errorMessage(error));
        }
      })
      .finally(() => {
        if (reviewDraft) {
          setBusy(false);
          updateSelectionState();
          if (focusNameAfterSubmit) {
            elements.nameInput.focus();
          }
        }
      });
  }

  elements.selectAllButton.addEventListener("click", () => {
    if (!reviewDraft || saveInFlight) {
      return;
    }
    reviewDraft = selectAllReviewFilters(reviewDraft);
    for (const checkbox of Array.from(elements.reviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      checkbox.checked = true;
    }
    updateSelectionState();
  });

  elements.clearAllButton.addEventListener("click", () => {
    if (!reviewDraft || saveInFlight) {
      return;
    }
    reviewDraft = clearAllReviewFilters(reviewDraft);
    for (const checkbox of Array.from(elements.reviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      checkbox.checked = false;
    }
    updateSelectionState();
  });

  elements.nameInput.addEventListener("input", () => {
    setMessage(elements.nameError, "");
    setMessage(elements.storageError, "");
  });

  elements.cancelButton.addEventListener("click", () => {
    close(true);
  });

  elements.confirmButton.addEventListener("click", confirm);

  return {
    open,
    close,
    confirm,
    isInFlight: () => saveInFlight
  };
}
