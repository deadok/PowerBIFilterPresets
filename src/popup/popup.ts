import "./popup.css";
import popupMarkup from "./popup.html?raw";
import { getActiveTab, sendContentRequestToActiveTab } from "./contentMessaging";
import { createPopupDialogState } from "./popupDialogState";
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
import { serializePresetExport } from "../shared/presetExport";
import { createPresetStore, type PresetStore } from "../shared/presetStore";
import { summarizeResults } from "../shared/resultSummary";
import type { ContentRequest, ContentResponse, FilterPresetItem, PagePresetCollection, Preset } from "../shared/types";
import { normalizePageUrl } from "../shared/url";

type PopupDependencies = {
  store: PresetStore;
  getActiveTab: typeof getActiveTab;
  sendContentRequest: (request: ContentRequest) => Promise<ContentResponse>;
  writeClipboard: (text: string) => Promise<void>;
  now: () => Date;
  randomUUID: () => string;
};

type PendingDeletion = {
  id: string;
  name: string;
  index: number;
  nextId?: string;
  previousId?: string;
};

type ActiveDialog = "save" | "rename" | "delete";

const selectedActionIds = ["apply-preset", "export-preset", "rename-preset", "delete-preset"] as const;

function createPreset(filters: FilterPresetItem[], name: string, dependencies: PopupDependencies): Preset {
  const now = dependencies.now().toISOString();
  return {
    id: dependencies.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    filters
  };
}

function renderResult(element: HTMLOutputElement, text: string): void {
  element.value = text;
  element.textContent = text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Popup action failed.";
}

function isPresetNameConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "PresetNameConflictError";
}

function runPopupAction(element: HTMLOutputElement, action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    renderResult(element, errorMessage(error));
  });
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Popup markup is missing ${selector}.`);
  }
  return element;
}

function setMessage(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = message.length === 0;
}

export async function mountPopup(app: HTMLDivElement, dependencies: PopupDependencies): Promise<void> {
  app.innerHTML = popupMarkup;

  const popupContent = requiredElement<HTMLDivElement>(app, ".popup-content");
  const pageStatus = requiredElement<HTMLParagraphElement>(app, "#page-status");
  const saveButton = requiredElement<HTMLButtonElement>(app, "#save-current");
  const applyButton = requiredElement<HTMLButtonElement>(app, "#apply-preset");
  const exportButton = requiredElement<HTMLButtonElement>(app, "#export-preset");
  const renameButton = requiredElement<HTMLButtonElement>(app, "#rename-preset");
  const deleteButton = requiredElement<HTMLButtonElement>(app, "#delete-preset");
  const presetSelect = requiredElement<HTMLSelectElement>(app, "#preset-select");
  const result = requiredElement<HTMLOutputElement>(app, "#result");
  const modalBackdrop = requiredElement<HTMLDivElement>(app, ".modal-backdrop");
  const saveDialog = requiredElement<HTMLElement>(app, "#save-review-dialog");
  const saveNameInput = requiredElement<HTMLInputElement>(app, "#save-name");
  const saveNameError = requiredElement<HTMLParagraphElement>(app, "#save-name-error");
  const saveStorageError = requiredElement<HTMLParagraphElement>(app, "#save-storage-error");
  const reviewList = requiredElement<HTMLDivElement>(app, "#review-filter-list");
  const reviewEmpty = requiredElement<HTMLParagraphElement>(app, "#review-empty");
  const reviewSelectionCount = requiredElement<HTMLParagraphElement>(app, "#review-selection-count");
  const reviewSelectionGuidance = requiredElement<HTMLParagraphElement>(app, "#review-selection-guidance");
  const selectAllButton = requiredElement<HTMLButtonElement>(app, "#select-all-filters");
  const clearAllButton = requiredElement<HTMLButtonElement>(app, "#clear-all-filters");
  const cancelSaveButton = requiredElement<HTMLButtonElement>(app, "#cancel-save");
  const confirmSaveButton = requiredElement<HTMLButtonElement>(app, "#confirm-save");
  const renameDialog = requiredElement<HTMLElement>(app, "#rename-dialog");
  const renameNameInput = requiredElement<HTMLInputElement>(app, "#rename-name");
  const renameNameError = requiredElement<HTMLParagraphElement>(app, "#rename-name-error");
  const renameStorageError = requiredElement<HTMLParagraphElement>(app, "#rename-storage-error");
  const cancelRenameButton = requiredElement<HTMLButtonElement>(app, "#cancel-rename");
  const confirmRenameButton = requiredElement<HTMLButtonElement>(app, "#confirm-rename");
  const deleteDialog = requiredElement<HTMLElement>(app, ".delete-dialog");
  const deletePresetName = requiredElement<HTMLElement>(app, "#delete-preset-name");
  const deleteError = requiredElement<HTMLParagraphElement>(app, "#delete-error");
  const cancelDeleteButton = requiredElement<HTMLButtonElement>(app, "#cancel-delete");
  const confirmDeleteButton = requiredElement<HTMLButtonElement>(app, "#confirm-delete");
  const iconButtons = Array.from(app.querySelectorAll<HTMLButtonElement>(".icon-button"));

  const tab = await dependencies.getActiveTab();
  const pageKey = normalizePageUrl(tab.url);
  let currentPresets: Preset[] = [];
  let reviewDraft: ReviewDraft | undefined;
  let pendingRenameId: string | undefined;
  let pendingDeletion: PendingDeletion | undefined;
  let captureInFlight = false;
  let saveInFlight = false;
  let renameInFlight = false;
  let deleteInFlight = false;
  const dialogState = createPopupDialogState<ActiveDialog>({
    background: popupContent,
    backdrop: modalBackdrop,
    dialogs: {
      save: saveDialog,
      rename: renameDialog,
      delete: deleteDialog
    }
  });

  function selectedPreset(): Preset | undefined {
    return currentPresets.find((preset) => preset.id === presetSelect.value);
  }

  async function storedSelectedPreset(): Promise<Preset | undefined> {
    const selectedId = presetSelect.value;
    const collection = await dependencies.store.getPageCollection(pageKey);
    return collection.presets.find((preset) => preset.id === selectedId);
  }

  function updateSelectedActionStates(): void {
    const hasSelection = Boolean(selectedPreset());
    for (const id of selectedActionIds) {
      requiredElement<HTMLButtonElement>(app, `#${id}`).disabled = !hasSelection;
    }
  }

  function renderCollection(collection: PagePresetCollection, preferredSelectionId?: string): void {
    currentPresets = collection.presets;
    presetSelect.replaceChildren();

    for (const preset of currentPresets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      option.title = preset.name;
      presetSelect.append(option);
    }

    if (preferredSelectionId && currentPresets.some((preset) => preset.id === preferredSelectionId)) {
      presetSelect.value = preferredSelectionId;
    }

    pageStatus.textContent = `${currentPresets.length} presets for this URL`;
    presetSelect.disabled = currentPresets.length === 0;
    updateSelectedActionStates();
  }

  async function refreshPresets(preferredSelectionId?: string): Promise<void> {
    renderCollection(await dependencies.store.getPageCollection(pageKey), preferredSelectionId);
  }

  function openDialog(kind: ActiveDialog): boolean {
    if (!dialogState.open(kind)) {
      return false;
    }
    if (kind === "save") {
      document.body.classList.add("review-open");
      modalBackdrop.classList.add("review-backdrop");
    }
    return true;
  }

  function closeDialog(kind: ActiveDialog): void {
    if (!dialogState.close(kind)) {
      return;
    }
    if (kind === "save") {
      document.body.classList.remove("review-open");
      modalBackdrop.classList.remove("review-backdrop");
    }
  }

  function updateReviewSelectionState(): void {
    const includedCount = reviewDraft?.filters.filter((item) => item.included).length ?? 0;
    const totalCount = reviewDraft?.filters.length ?? 0;
    reviewSelectionCount.textContent = `${includedCount} of ${totalCount} filters selected`;
    reviewSelectionGuidance.textContent = includedCount === 0 ? "Select at least one filter." : "";
    confirmSaveButton.disabled = includedCount === 0 || saveInFlight;
    selectAllButton.disabled = totalCount === 0 || saveInFlight;
    clearAllButton.disabled = totalCount === 0 || saveInFlight;
  }

  function setReviewControlsDisabled(disabled: boolean): void {
    saveNameInput.disabled = disabled;
    for (const control of Array.from(
      reviewList.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")
    )) {
      control.disabled = disabled;
    }
  }

  function setCaptureBusy(busy: boolean): void {
    captureInFlight = busy;
    saveButton.disabled = busy;
    presetSelect.disabled = busy || currentPresets.length === 0;
    if (busy) {
      for (const id of selectedActionIds) {
        requiredElement<HTMLButtonElement>(app, `#${id}`).disabled = true;
      }
    } else {
      updateSelectedActionStates();
    }
  }

  function renderReviewFilters(): void {
    reviewList.replaceChildren();
    const filters = reviewDraft?.filters ?? [];
    reviewList.hidden = filters.length === 0;
    reviewEmpty.hidden = filters.length > 0;

    for (const item of filters) {
      const article = document.createElement("article");
      article.className = "review-filter";
      article.dataset.capturedIndex = String(item.capturedIndex);

      const row = document.createElement("div");
      row.className = "review-filter-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.included;
      checkbox.setAttribute("aria-label", `Include ${item.filter.title}`);

      const disclosure = document.createElement("button");
      disclosure.type = "button";
      disclosure.className = "review-filter-disclosure";
      disclosure.setAttribute("aria-label", `Show values for ${item.filter.title}`);
      disclosure.setAttribute("aria-expanded", String(item.expanded));
      disclosure.setAttribute("aria-controls", `review-values-${item.capturedIndex}`);
      disclosure.innerHTML =
        '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"></path></svg>';

      const title = document.createElement("span");
      title.className = "review-filter-title";
      title.textContent = item.filter.title;

      const count = document.createElement("span");
      count.className = "review-filter-count";
      count.textContent = String(item.filter.selectedLabels.length);
      count.setAttribute(
        "aria-label",
        `${item.filter.selectedLabels.length} selected ${item.filter.selectedLabels.length === 1 ? "value" : "values"}`
      );

      const values = document.createElement("ul");
      values.id = `review-values-${item.capturedIndex}`;
      values.className = "review-filter-values";
      values.hidden = !item.expanded;
      for (const label of item.filter.selectedLabels) {
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
        disclosure.setAttribute("aria-label", `${nextExpanded ? "Hide" : "Show"} values for ${item.filter.title}`);
        values.hidden = !nextExpanded;
      };

      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (!reviewDraft || saveInFlight) {
          return;
        }
        reviewDraft = setReviewFilterIncluded(reviewDraft, item.capturedIndex, checkbox.checked);
        updateReviewSelectionState();
      });
      disclosure.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleExpansion();
      });
      row.addEventListener("click", toggleExpansion);

      row.append(checkbox, disclosure, title, count);
      article.append(row, values);
      reviewList.append(article);
    }

    updateReviewSelectionState();
  }

  function closeSaveDialog(restoreFocus: boolean): void {
    closeDialog("save");
    reviewDraft = undefined;
    saveInFlight = false;
    saveNameInput.disabled = false;
    saveNameInput.value = "";
    setMessage(saveNameError, "");
    setMessage(saveStorageError, "");
    cancelSaveButton.disabled = false;
    if (restoreFocus) {
      saveButton.focus();
    }
  }

  function openSaveDialog(filters: FilterPresetItem[]): boolean {
    reviewDraft = createReviewDraft(filters);
    saveNameInput.value = `Preset ${dependencies.now().toLocaleString()}`;
    setMessage(saveNameError, "");
    setMessage(saveStorageError, "");
    cancelSaveButton.disabled = false;
    renderReviewFilters();
    if (!openDialog("save")) {
      reviewDraft = undefined;
      return false;
    }
    saveNameInput.focus();
    saveNameInput.select();
    return true;
  }

  function closeRenameDialog(restoreFocus: boolean): void {
    closeDialog("rename");
    pendingRenameId = undefined;
    renameInFlight = false;
    renameNameInput.disabled = false;
    renameNameInput.value = "";
    setMessage(renameNameError, "");
    setMessage(renameStorageError, "");
    cancelRenameButton.disabled = false;
    confirmRenameButton.disabled = false;
    if (restoreFocus) {
      renameButton.focus();
    }
  }

  function closeDeleteDialog(restoreTriggerFocus: boolean): void {
    closeDialog("delete");
    pendingDeletion = undefined;
    setMessage(deleteError, "");
    cancelDeleteButton.disabled = false;
    confirmDeleteButton.disabled = false;
    deleteInFlight = false;
    deleteDialog.removeAttribute("aria-busy");

    if (restoreTriggerFocus) {
      deleteButton.focus();
    }
  }

  function openDeleteDialog(): void {
    if (captureInFlight || dialogState.active || pendingDeletion) {
      return;
    }

    const preset = selectedPreset();
    const index = preset ? currentPresets.findIndex((candidate) => candidate.id === preset.id) : -1;
    if (!preset || index < 0) {
      renderResult(result, "Select a preset first.");
      updateSelectedActionStates();
      return;
    }

    pendingDeletion = {
      id: preset.id,
      name: preset.name,
      index,
      nextId: currentPresets[index + 1]?.id,
      previousId: currentPresets[index - 1]?.id
    };
    deletePresetName.textContent = `“${preset.name}”`;
    setMessage(deleteError, "");
    if (!openDialog("delete")) {
      pendingDeletion = undefined;
      return;
    }
    cancelDeleteButton.focus();
  }

  function selectionAfterDeletion(collection: PagePresetCollection, deletion: PendingDeletion): string | undefined {
    const availableIds = new Set(collection.presets.map((preset) => preset.id));
    if (deletion.nextId && availableIds.has(deletion.nextId)) {
      return deletion.nextId;
    }
    if (deletion.previousId && availableIds.has(deletion.previousId)) {
      return deletion.previousId;
    }
    return collection.presets[Math.min(deletion.index, collection.presets.length - 1)]?.id;
  }

  saveButton.addEventListener("click", () => {
    if (captureInFlight || dialogState.active) {
      return;
    }
    setCaptureBusy(true);
    renderResult(result, "Reading filters...");

    void dependencies
      .sendContentRequest({ type: "READ_FILTERS" })
      .then((response) => {
        if (!response.ok || !("filters" in response)) {
          renderResult(result, response.ok ? "No filters returned." : response.error);
          return;
        }
        openSaveDialog(response.filters);
      })
      .catch((error: unknown) => {
        renderResult(result, errorMessage(error));
      })
      .finally(() => {
        setCaptureBusy(false);
      });
  });

  selectAllButton.addEventListener("click", () => {
    if (!reviewDraft || saveInFlight) {
      return;
    }
    reviewDraft = selectAllReviewFilters(reviewDraft);
    for (const checkbox of Array.from(reviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      checkbox.checked = true;
    }
    updateReviewSelectionState();
  });

  clearAllButton.addEventListener("click", () => {
    if (!reviewDraft || saveInFlight) {
      return;
    }
    reviewDraft = clearAllReviewFilters(reviewDraft);
    for (const checkbox of Array.from(reviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      checkbox.checked = false;
    }
    updateReviewSelectionState();
  });

  saveNameInput.addEventListener("input", () => {
    setMessage(saveNameError, "");
    setMessage(saveStorageError, "");
  });

  cancelSaveButton.addEventListener("click", () => {
    if (!saveInFlight) {
      closeSaveDialog(true);
    }
  });

  confirmSaveButton.addEventListener("click", () => {
    if (!reviewDraft || saveInFlight) {
      return;
    }
    const includedFilters = projectIncludedFilters(reviewDraft);
    if (includedFilters.length === 0) {
      updateReviewSelectionState();
      return;
    }

    saveInFlight = true;
    setReviewControlsDisabled(true);
    cancelSaveButton.disabled = true;
    confirmSaveButton.disabled = true;
    saveDialog.setAttribute("aria-busy", "true");
    setMessage(saveNameError, "");
    setMessage(saveStorageError, "");
    let focusNameAfterSubmit = false;

    void dependencies.store
      .getPageCollection(pageKey)
      .then(async (collection) => {
        const validation = validatePresetName(saveNameInput.value, collection);
        if (!validation.valid) {
          setMessage(saveNameError, validation.error);
          focusNameAfterSubmit = true;
          return;
        }

        const preset = createPreset(includedFilters, validation.name, dependencies);
        const nextCollection = await dependencies.store.savePreset(pageKey, preset, {
          uniqueNormalizedName: normalizePresetName(validation.name)
        });
        renderCollection(nextCollection, preset.id);
        closeSaveDialog(false);
        saveDialog.removeAttribute("aria-busy");
        renderResult(result, `Saved ${includedFilters.length} filters.`);
        applyButton.focus();
      })
      .catch((error: unknown) => {
        if (isPresetNameConflict(error)) {
          setMessage(saveNameError, errorMessage(error));
          focusNameAfterSubmit = true;
        } else {
          setMessage(saveStorageError, errorMessage(error));
        }
      })
      .finally(() => {
        if (dialogState.active === "save") {
          saveInFlight = false;
          setReviewControlsDisabled(false);
          saveDialog.removeAttribute("aria-busy");
          cancelSaveButton.disabled = false;
          updateReviewSelectionState();
          if (focusNameAfterSubmit) {
            saveNameInput.focus();
          }
        }
      });
  });

  applyButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const preset = await storedSelectedPreset();
      if (!preset) {
        renderResult(result, "Select a preset first.");
        updateSelectedActionStates();
        return;
      }

      renderResult(result, "Applying preset...");
      const response = await dependencies.sendContentRequest({ type: "APPLY_FILTERS", filters: preset.filters });

      if (!response.ok || !("results" in response)) {
        renderResult(result, response.ok ? "No results returned." : response.error);
        return;
      }

      const details = response.results.map((item) => `${item.title}: ${item.message}`).join("\n");
      renderResult(result, `${summarizeResults(response.results)}\n${details}`);
    });
  });

  exportButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const preset = await storedSelectedPreset();
      if (!preset) {
        renderResult(result, "Select a preset first.");
        updateSelectedActionStates();
        return;
      }

      await dependencies.writeClipboard(serializePresetExport(preset));
      renderResult(result, "Preset JSON copied.");
    });
  });

  renameButton.addEventListener("click", () => {
    if (captureInFlight || dialogState.active) {
      return;
    }
    runPopupAction(result, async () => {
      const selectedId = presetSelect.value;
      const preset = await storedSelectedPreset();
      if (!preset || preset.id !== selectedId || presetSelect.value !== selectedId) {
        renderResult(result, "Select a preset first.");
        updateSelectedActionStates();
        return;
      }

      renameNameInput.value = preset.name.trim();
      setMessage(renameNameError, "");
      setMessage(renameStorageError, "");
      if (!openDialog("rename")) {
        return;
      }
      pendingRenameId = preset.id;
      renameNameInput.focus();
      renameNameInput.select();
    });
  });

  renameNameInput.addEventListener("input", () => {
    setMessage(renameNameError, "");
    setMessage(renameStorageError, "");
  });

  saveNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !saveInFlight) {
      event.preventDefault();
      confirmSaveButton.click();
    }
  });

  renameNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !renameInFlight) {
      event.preventDefault();
      confirmRenameButton.click();
    }
  });

  cancelRenameButton.addEventListener("click", () => {
    if (!renameInFlight) {
      closeRenameDialog(true);
    }
  });

  confirmRenameButton.addEventListener("click", () => {
    if (!pendingRenameId || renameInFlight) {
      return;
    }
    const renameId = pendingRenameId;
    renameInFlight = true;
    renameNameInput.disabled = true;
    cancelRenameButton.disabled = true;
    confirmRenameButton.disabled = true;
    renameDialog.setAttribute("aria-busy", "true");
    setMessage(renameNameError, "");
    setMessage(renameStorageError, "");
    let focusNameAfterSubmit = false;

    void dependencies.store
      .getPageCollection(pageKey)
      .then(async (collection) => {
        const preset = collection.presets.find((candidate) => candidate.id === renameId);
        if (!preset) {
          throw new Error("The selected preset no longer exists.");
        }
        const validation = validatePresetName(renameNameInput.value, collection, renameId);
        if (!validation.valid) {
          setMessage(renameNameError, validation.error);
          focusNameAfterSubmit = true;
          return;
        }

        const nextCollection = await dependencies.store.savePreset(
          pageKey,
          {
            ...preset,
            name: validation.name,
            updatedAt: dependencies.now().toISOString()
          },
          {
            requireExisting: true,
            uniqueNormalizedName: normalizePresetName(validation.name)
          }
        );
        renderCollection(nextCollection, preset.id);
        closeRenameDialog(false);
        renameDialog.removeAttribute("aria-busy");
        renderResult(result, "Preset renamed.");
        renameButton.focus();
      })
      .catch((error: unknown) => {
        if (isPresetNameConflict(error)) {
          setMessage(renameNameError, errorMessage(error));
          focusNameAfterSubmit = true;
        } else {
          setMessage(renameStorageError, errorMessage(error));
        }
      })
      .finally(() => {
        if (dialogState.active === "rename") {
          renameInFlight = false;
          renameNameInput.disabled = false;
          renameDialog.removeAttribute("aria-busy");
          cancelRenameButton.disabled = false;
          confirmRenameButton.disabled = false;
          if (focusNameAfterSubmit) {
            renameNameInput.focus();
          }
        }
      });
  });

  deleteButton.addEventListener("click", openDeleteDialog);
  cancelDeleteButton.addEventListener("click", () => {
    if (!deleteInFlight) {
      closeDeleteDialog(true);
    }
  });
  confirmDeleteButton.addEventListener("click", () => {
    if (!pendingDeletion || deleteInFlight) {
      return;
    }

    const deletion = pendingDeletion;
    deleteInFlight = true;
    cancelDeleteButton.disabled = true;
    confirmDeleteButton.disabled = true;
    deleteDialog.setAttribute("aria-busy", "true");
    deleteDialog.focus();
    setMessage(deleteError, "");

    void dependencies.store
      .deletePreset(pageKey, deletion.id)
      .then((collection) => {
        const preferredSelectionId = selectionAfterDeletion(collection, deletion);
        renderCollection(collection, preferredSelectionId);
        closeDeleteDialog(false);
        renderResult(result, "Preset deleted.");

        if (currentPresets.length > 0) {
          presetSelect.focus();
        } else {
          saveButton.focus();
        }
      })
      .catch((error: unknown) => {
        deleteInFlight = false;
        deleteDialog.removeAttribute("aria-busy");
        cancelDeleteButton.disabled = false;
        confirmDeleteButton.disabled = false;
        setMessage(deleteError, errorMessage(error));
        cancelDeleteButton.focus();
      });
  });

  presetSelect.addEventListener("change", updateSelectedActionStates);

  for (const button of iconButtons) {
    const revealTooltip = () => button.classList.remove("tooltip-suppressed");
    button.addEventListener("blur", revealTooltip);
    button.addEventListener("mouseleave", revealTooltip);
  }

  app.addEventListener("keydown", (event) => {
    if (!dialogState.active) {
      if (event.key === "Escape" && event.target instanceof HTMLButtonElement && event.target.matches(".icon-button")) {
        event.target.classList.add("tooltip-suppressed");
      }
      return;
    }

    if (event.key === "Escape") {
      const operationInFlight = saveInFlight || renameInFlight || deleteInFlight;
      event.preventDefault();
      if (operationInFlight) {
        return;
      }
      if (dialogState.active === "save") {
        closeSaveDialog(true);
      } else if (dialogState.active === "rename") {
        closeRenameDialog(true);
      } else {
        closeDeleteDialog(true);
      }
      return;
    }

    dialogState.trapTab(event);
  });

  await refreshPresets();
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  const dependencies: PopupDependencies = {
    store: createPresetStore(),
    getActiveTab,
    sendContentRequest: sendContentRequestToActiveTab,
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID()
  };

  mountPopup(app, dependencies).catch((error: unknown) => {
    app.textContent = errorMessage(error);
  });
}
