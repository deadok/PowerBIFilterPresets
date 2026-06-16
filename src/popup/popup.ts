import "./popup.css";
import popupMarkup from "./popup.html?raw";
import { getActiveTab, sendContentRequestToActiveTab } from "./contentMessaging";
import { getPopupElements } from "./popupElements";
import { createPopupDialogState } from "./popupDialogState";
import { normalizePresetName, validatePresetName } from "./presetNameValidation";
import { createApplyResultLines, createResultLine, renderResult } from "./resultLog";
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
  createCreatePresetDocument,
  createEditPresetDocument,
  formatCreatePresetJson,
  formatEditPresetJson,
  resetCreatePresetJson,
  resetEditPresetJson,
  sanitizeImportedPresetDocument,
  validateCreatePresetJson,
  validateEditPresetJson,
  type CreatePresetJsonResult,
  type EditPresetJsonResult
} from "../shared/presetJsonEditor";
import { serializePresetExport } from "../shared/presetExport";
import { createPresetRevision } from "../shared/presetRevision";
import { createPresetStore, type PresetStore } from "../shared/presetStore";
import type { FilterPresetItem, PagePresetCollection, Preset, SendContentRequest } from "../shared/types";
import { normalizePageUrl } from "../shared/url";

type PopupDependencies = {
  store: PresetStore;
  getActiveTab: typeof getActiveTab;
  sendContentRequest: SendContentRequest;
  readClipboardText: () => Promise<string>;
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

type EditDraft = {
  originalPreset: Preset;
  originalRevision: string;
  currentName: string;
  jsonText: string;
  validation: EditPresetJsonResult;
  nameSyncPending: boolean;
};

type CreateDraft = {
  provisionalPreset: Preset;
  currentName: string;
  jsonText: string;
  validation: CreatePresetJsonResult;
  nameManual: boolean;
  nameSyncPending: boolean;
  sessionToken: number;
};

type ActiveDialog = "save" | "create" | "createReset" | "edit" | "editReset" | "delete";

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Popup action failed.";
}

function clipboardReadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError") {
      return "Clipboard access was denied.";
    }
    return error.message || "Clipboard could not be read.";
  }

  return "Clipboard could not be read.";
}

function isPresetNameConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "PresetNameConflictError";
}

function runPopupAction(element: HTMLOutputElement, action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    renderResult(element, createResultLine(errorMessage(error), "error"));
  });
}

function setMessage(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = message.length === 0;
}

export async function mountPopup(app: HTMLDivElement, dependencies: PopupDependencies): Promise<void> {
  app.innerHTML = popupMarkup;

  const {
    popupContent,
    pageStatus,
    saveButton,
    createButton,
    applyButton,
    exportButton,
    renameButton,
    deleteButton,
    selectedActionButtons,
    presetSelect,
    result,
    modalBackdrop,
    saveDialog,
    saveNameInput,
    saveNameError,
    saveStorageError,
    reviewList,
    reviewEmpty,
    reviewSelectionCount,
    reviewSelectionGuidance,
    selectAllButton,
    clearAllButton,
    cancelSaveButton,
    confirmSaveButton,
    createDialog,
    createNameInput,
    createNameError,
    createJsonInput,
    createValidation,
    createSaveError,
    pasteCreateJsonButton,
    formatCreateJsonButton,
    resetCreateJsonButton,
    cancelCreateButton,
    confirmCreateButton,
    editDialog,
    editNameInput,
    editNameError,
    editJsonInput,
    editValidation,
    editSaveError,
    formatEditJsonButton,
    resetEditJsonButton,
    cancelEditButton,
    confirmEditButton,
    createResetDialog,
    cancelCreateResetButton,
    confirmCreateResetButton,
    editResetDialog,
    cancelEditResetButton,
    confirmEditResetButton,
    deleteDialog,
    deletePresetName,
    deleteError,
    cancelDeleteButton,
    confirmDeleteButton,
    iconButtons
  } = getPopupElements(app);

  const tab = await dependencies.getActiveTab();
  const pageKey = normalizePageUrl(tab.url);
  let currentPresets: Preset[] = [];
  let reviewDraft: ReviewDraft | undefined;
  let createDraft: CreateDraft | undefined;
  let editDraft: EditDraft | undefined;
  let pendingDeletion: PendingDeletion | undefined;
  let captureInFlight = false;
  let saveInFlight = false;
  let createInFlight = false;
  let editInFlight = false;
  let deleteInFlight = false;
  let createValidationTimer: number | undefined;
  let createValidationToken = 0;
  let editValidationTimer: number | undefined;
  let editValidationToken = 0;
  let createResetRestoreFocusTarget: HTMLElement | undefined;
  let editResetRestoreFocusTarget: HTMLElement | undefined;
  let createSessionToken = 0;
  const dialogState = createPopupDialogState<ActiveDialog>({
    background: popupContent,
    backdrop: modalBackdrop,
    dialogs: {
      save: saveDialog,
      create: createDialog,
      createReset: createResetDialog,
      edit: editDialog,
      editReset: editResetDialog,
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
    for (const button of Object.values(selectedActionButtons)) {
      button.disabled = !hasSelection;
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
    if (kind === "save" || kind === "create" || kind === "createReset" || kind === "edit" || kind === "editReset") {
      document.body.classList.add("review-open");
      modalBackdrop.classList.add("review-backdrop");
    }
    return true;
  }

  function closeDialog(kind: ActiveDialog): void {
    if (!dialogState.close(kind)) {
      return;
    }
    if (kind === "save" || kind === "create" || kind === "createReset" || kind === "edit" || kind === "editReset") {
      document.body.classList.remove("review-open");
      modalBackdrop.classList.remove("review-backdrop");
    }
  }

  function createProvisionalPreset(name = ""): Preset {
    const now = dependencies.now().toISOString();
    return {
      id: dependencies.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      filters: []
    };
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
    createButton.disabled = busy;
    presetSelect.disabled = busy || currentPresets.length === 0;
    if (busy) {
      for (const button of Object.values(selectedActionButtons)) {
        button.disabled = true;
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

  function renderCreateValidationMessage(message: string, invalid: boolean): void {
    createValidation.textContent = message;
    createValidation.classList.toggle("is-invalid", invalid);
  }

  function setCreateControlsDisabled(disabled: boolean): void {
    createNameInput.disabled = disabled;
    createJsonInput.disabled = disabled;
    pasteCreateJsonButton.disabled = disabled;
    formatCreateJsonButton.disabled = disabled;
    resetCreateJsonButton.disabled = disabled;
    cancelCreateButton.disabled = disabled;
    confirmCreateButton.disabled = disabled;
  }

  function clearCreateValidationTimer(): void {
    if (createValidationTimer !== undefined) {
      window.clearTimeout(createValidationTimer);
      createValidationTimer = undefined;
    }
  }

  function applyCreateValidationResult(validation: CreatePresetJsonResult, nextText?: string): void {
    if (!createDraft) {
      return;
    }

    createDraft.validation = validation;
    if (nextText !== undefined) {
      createDraft.jsonText = nextText;
      createJsonInput.value = nextText;
    } else {
      createDraft.jsonText = createJsonInput.value;
    }

    if (validation.valid) {
      renderCreateValidationMessage("JSON is valid.", false);
      setMessage(createSaveError, "");
    } else {
      renderCreateValidationMessage(validation.error.message, true);
    }

    pasteCreateJsonButton.disabled = createInFlight;
    formatCreateJsonButton.disabled = createInFlight || !validation.valid;
    resetCreateJsonButton.disabled = createInFlight;
    confirmCreateButton.disabled = createInFlight;
  }

  function validateCreateDraftNow(allowPendingNameSync: boolean): CreatePresetJsonResult | undefined {
    if (!createDraft) {
      return undefined;
    }

    let nextText = createJsonInput.value;
    let authoritativeName = createDraft.currentName;
    let allowNameMismatch = allowPendingNameSync;
    const imported = sanitizeImportedPresetDocument(nextText, {
      provisionalPreset: createDraft.provisionalPreset
    });
    if (imported.valid) {
      nextText = imported.text;
      if (!createDraft.nameManual) {
        authoritativeName = imported.adoptedName;
        createDraft.currentName = authoritativeName;
        createNameInput.value = authoritativeName;
      } else {
        allowNameMismatch = true;
      }
    }

    const validation = validateCreatePresetJson(nextText, {
      provisionalPreset: createDraft.provisionalPreset,
      authoritativeName,
      allowNameMismatch
    });

    if (validation.valid) {
      createDraft.nameSyncPending = false;
      applyCreateValidationResult(validation, validation.synchronizedText);
    } else {
      applyCreateValidationResult(validation, imported.valid ? imported.text : undefined);
    }

    return validation;
  }

  function scheduleCreateValidation(): void {
    if (!createDraft) {
      return;
    }

    clearCreateValidationTimer();
    const token = ++createValidationToken;
    const sessionToken = createDraft.sessionToken;
    createValidationTimer = window.setTimeout(() => {
      if (!createDraft || dialogState.active !== "create" || token !== createValidationToken || createDraft.sessionToken !== sessionToken) {
        return;
      }
      validateCreateDraftNow(createDraft.nameSyncPending);
    }, 250);
  }

  function resetCreateDraftState(): void {
    clearCreateValidationTimer();
    createValidationToken += 1;
    createDraft = undefined;
    createInFlight = false;
    createNameInput.value = "";
    createJsonInput.value = "";
    setCreateControlsDisabled(false);
    setMessage(createNameError, "");
    setMessage(createSaveError, "");
    renderCreateValidationMessage("", false);
  }

  function closeCreateDialog(restoreFocus: boolean): void {
    closeDialog("create");
    resetCreateDraftState();
    if (restoreFocus) {
      createButton.focus();
    }
  }

  function openCreateDialog(): void {
    const provisionalPreset = createProvisionalPreset();
    const jsonText = createCreatePresetDocument(provisionalPreset);
    createDraft = {
      provisionalPreset,
      currentName: "",
      jsonText,
      validation: validateCreatePresetJson(jsonText, {
        provisionalPreset,
        authoritativeName: ""
      }),
      nameManual: false,
      nameSyncPending: false,
      sessionToken: ++createSessionToken
    };

    createNameInput.value = "";
    createJsonInput.value = jsonText;
    setMessage(createNameError, "");
    setMessage(createSaveError, "");
    setCreateControlsDisabled(false);
    applyCreateValidationResult(createDraft.validation, jsonText);
    if (!openDialog("create")) {
      createDraft = undefined;
      return;
    }
    createNameInput.focus();
  }

  function openCreateResetDialog(): void {
    if (!createDraft || createInFlight) {
      return;
    }

    createResetRestoreFocusTarget = resetCreateJsonButton;
    closeDialog("create");
    if (!openDialog("createReset")) {
      openDialog("create");
      return;
    }
    cancelCreateResetButton.focus();
  }

  function closeCreateResetDialog(restoreFocus: boolean): void {
    closeDialog("createReset");
    if (createDraft) {
      openDialog("create");
    }
    if (restoreFocus) {
      (createResetRestoreFocusTarget ?? resetCreateJsonButton).focus();
    }
    createResetRestoreFocusTarget = undefined;
  }

  function renderEditValidationMessage(message: string, invalid: boolean): void {
    editValidation.textContent = message;
    editValidation.classList.toggle("is-invalid", invalid);
  }

  function setEditControlsDisabled(disabled: boolean): void {
    editNameInput.disabled = disabled;
    editJsonInput.disabled = disabled;
    formatEditJsonButton.disabled = disabled;
    resetEditJsonButton.disabled = disabled;
    cancelEditButton.disabled = disabled;
    confirmEditButton.disabled = disabled;
  }

  function clearEditValidationTimer(): void {
    if (editValidationTimer !== undefined) {
      window.clearTimeout(editValidationTimer);
      editValidationTimer = undefined;
    }
  }

  function applyEditValidationResult(validation: EditPresetJsonResult, nextText?: string): void {
    if (!editDraft) {
      return;
    }

    editDraft.validation = validation;
    if (nextText !== undefined) {
      editDraft.jsonText = nextText;
      editJsonInput.value = nextText;
    } else {
      editDraft.jsonText = editJsonInput.value;
    }

    if (validation.valid) {
      renderEditValidationMessage("JSON is valid.", false);
      setMessage(editSaveError, "");
    } else {
      renderEditValidationMessage(validation.error.message, true);
    }

    formatEditJsonButton.disabled = editInFlight || !validation.valid;
    resetEditJsonButton.disabled = editInFlight;
    confirmEditButton.disabled = editInFlight;
  }

  function validateEditDraftNow(allowPendingNameSync: boolean): EditPresetJsonResult | undefined {
    if (!editDraft) {
      return undefined;
    }

    const validation = validateEditPresetJson(editJsonInput.value, {
      preset: editDraft.originalPreset,
      authoritativeName: editDraft.currentName,
      allowNameMismatch: allowPendingNameSync
    });

    if (validation.valid) {
      editDraft.nameSyncPending = false;
      applyEditValidationResult(validation, validation.synchronizedText);
    } else {
      applyEditValidationResult(validation);
    }

    return validation;
  }

  function scheduleEditValidation(): void {
    if (!editDraft) {
      return;
    }

    clearEditValidationTimer();
    const token = ++editValidationToken;
    editValidationTimer = window.setTimeout(() => {
      if (!editDraft || dialogState.active !== "edit" || token !== editValidationToken) {
        return;
      }
      validateEditDraftNow(editDraft.nameSyncPending);
    }, 250);
  }

  function closeEditDialog(restoreFocus: boolean): void {
    clearEditValidationTimer();
    editValidationToken += 1;
    closeDialog("edit");
    editDraft = undefined;
    editInFlight = false;
    editNameInput.value = "";
    editJsonInput.value = "";
    setEditControlsDisabled(false);
    setMessage(editNameError, "");
    setMessage(editSaveError, "");
    renderEditValidationMessage("", false);
    if (restoreFocus) {
      renameButton.focus();
    }
  }

  function openEditDialog(preset: Preset): void {
    const jsonText = createEditPresetDocument(preset);
    editDraft = {
      originalPreset: preset,
      originalRevision: createPresetRevision(preset),
      currentName: preset.name.trim(),
      jsonText,
      validation: validateEditPresetJson(jsonText, {
        preset,
        authoritativeName: preset.name.trim()
      }),
      nameSyncPending: false
    };

    editNameInput.value = editDraft.currentName;
    editJsonInput.value = jsonText;
    setMessage(editNameError, "");
    setMessage(editSaveError, "");
    setEditControlsDisabled(false);
    applyEditValidationResult(editDraft.validation, jsonText);
    if (!openDialog("edit")) {
      editDraft = undefined;
      return;
    }
    editNameInput.focus();
    editNameInput.select();
  }

  function openResetDialog(): void {
    if (!editDraft || editInFlight) {
      return;
    }

    editResetRestoreFocusTarget = resetEditJsonButton;
    closeDialog("edit");
    if (!openDialog("editReset")) {
      openDialog("edit");
      return;
    }
    cancelEditResetButton.focus();
  }

  function closeResetDialog(restoreFocus: boolean): void {
    closeDialog("editReset");
    if (editDraft) {
      openDialog("edit");
    }
    if (restoreFocus) {
      (editResetRestoreFocusTarget ?? resetEditJsonButton).focus();
    }
    editResetRestoreFocusTarget = undefined;
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
      renderResult(result, createResultLine("Select a preset first.", "error"));
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
    renderResult(result, createResultLine("Reading filters...", "normal"));

    void dependencies
      .sendContentRequest({ type: "READ_FILTERS" })
      .then((response) => {
        if (!response.ok || !("filters" in response)) {
          renderResult(result, createResultLine(response.ok ? "No filters returned." : response.error, "error"));
          return;
        }
        openSaveDialog(response.filters);
      })
      .catch((error: unknown) => {
        renderResult(result, createResultLine(errorMessage(error), "error"));
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
        renderResult(result, createResultLine(`Saved ${includedFilters.length} filters.`, "normal"));
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
        renderResult(result, createResultLine("Select a preset first.", "error"));
        updateSelectedActionStates();
        return;
      }

      renderResult(result, createResultLine("Applying preset...", "normal"));
      const response = await dependencies.sendContentRequest({ type: "APPLY_FILTERS", filters: preset.filters });

      if (!response.ok || !("results" in response)) {
        renderResult(result, createResultLine(response.ok ? "No results returned." : response.error, "error"));
        return;
      }

      renderResult(result, createApplyResultLines(response.results));
    });
  });

  exportButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const preset = await storedSelectedPreset();
      if (!preset) {
        renderResult(result, createResultLine("Select a preset first.", "error"));
        updateSelectedActionStates();
        return;
      }

      await dependencies.writeClipboard(serializePresetExport(preset));
      renderResult(result, createResultLine("Preset JSON copied.", "normal"));
    });
  });

  createButton.addEventListener("click", () => {
    if (captureInFlight || dialogState.active) {
      return;
    }
    openCreateDialog();
  });

  createNameInput.addEventListener("input", () => {
    if (!createDraft || createInFlight) {
      return;
    }

    createDraft.currentName = createNameInput.value;
    createDraft.nameManual = true;
    setMessage(createNameError, "");
    setMessage(createSaveError, "");

    if (createDraft.validation.valid) {
      applyCreateValidationResult(
        {
          ...createDraft.validation,
          normalizedPreset: {
            ...createDraft.validation.normalizedPreset,
            name: createDraft.currentName
          },
          synchronizedText: resetCreatePresetJson(
            {
              ...createDraft.provisionalPreset,
              filters: createDraft.validation.filters
            },
            createDraft.currentName
          ),
          formattedText: resetCreatePresetJson(
            {
              ...createDraft.provisionalPreset,
              filters: createDraft.validation.filters
            },
            createDraft.currentName
          )
        },
        resetCreatePresetJson(
          {
            ...createDraft.provisionalPreset,
            filters: createDraft.validation.filters
          },
          createDraft.currentName
        )
      );
      createDraft.nameSyncPending = false;
      return;
    }

    createDraft.nameSyncPending = true;
  });

  createNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !createInFlight) {
      event.preventDefault();
      confirmCreateButton.click();
    }
  });

  createJsonInput.addEventListener("input", () => {
    if (!createDraft || createInFlight) {
      return;
    }

    createDraft.jsonText = createJsonInput.value;
    setMessage(createSaveError, "");
    scheduleCreateValidation();
  });

  pasteCreateJsonButton.addEventListener("click", () => {
    if (!createDraft || createInFlight) {
      return;
    }

    const sessionToken = createDraft.sessionToken;
    setMessage(createSaveError, "");

    void dependencies
      .readClipboardText()
      .then((text) => {
        if (!createDraft || dialogState.active !== "create" || createDraft.sessionToken !== sessionToken) {
          return;
        }
        if (text.length === 0) {
          renderCreateValidationMessage("Clipboard does not contain preset JSON.", true);
          return;
        }

        const imported = sanitizeImportedPresetDocument(text, {
          provisionalPreset: createDraft.provisionalPreset
        });
        if (!imported.valid) {
          renderCreateValidationMessage(imported.error.message, true);
          return;
        }

        if (!createDraft.nameManual) {
          createDraft.currentName = imported.adoptedName;
          createNameInput.value = imported.adoptedName;
        }

        const validation = validateCreatePresetJson(imported.text, {
          provisionalPreset: createDraft.provisionalPreset,
          authoritativeName: createDraft.currentName,
          allowNameMismatch: createDraft.nameManual
        });
        if (validation.valid) {
          createDraft.nameSyncPending = false;
          applyCreateValidationResult(validation, validation.synchronizedText);
        } else {
          createDraft.nameSyncPending = true;
          applyCreateValidationResult(validation, imported.text);
        }
      })
      .catch((error: unknown) => {
        if (!createDraft || dialogState.active !== "create" || createDraft.sessionToken !== sessionToken) {
          return;
        }
        renderCreateValidationMessage(clipboardReadErrorMessage(error), true);
      });
  });

  formatCreateJsonButton.addEventListener("click", () => {
    if (!createDraft || createInFlight || !createDraft.validation.valid) {
      return;
    }

    const formattedText = formatCreatePresetJson(createJsonInput.value, {
      provisionalPreset: createDraft.provisionalPreset,
      authoritativeName: createDraft.currentName
    });
    applyCreateValidationResult(createDraft.validation, formattedText);
  });

  resetCreateJsonButton.addEventListener("click", () => {
    if (!createDraft || createInFlight) {
      return;
    }

    const resetText = createCreatePresetDocument(createDraft.provisionalPreset);
    if (createJsonInput.value === resetText && createNameInput.value.length === 0 && !createDraft.nameManual) {
      applyCreateValidationResult(
        validateCreatePresetJson(resetText, {
          provisionalPreset: createDraft.provisionalPreset,
          authoritativeName: ""
        }),
        resetText
      );
      createJsonInput.focus();
      return;
    }

    openCreateResetDialog();
  });

  cancelCreateButton.addEventListener("click", () => {
    if (!createInFlight) {
      closeCreateDialog(true);
    }
  });

  confirmCreateButton.addEventListener("click", () => {
    if (!createDraft || createInFlight) {
      return;
    }

    clearCreateValidationTimer();
    const currentDraft = createDraft;
    const collectionValidation = validatePresetName(createNameInput.value, { schemaVersion: 1, pageKey, presets: currentPresets });
    if (!collectionValidation.valid) {
      setMessage(createNameError, collectionValidation.error);
      createNameInput.focus();
      return;
    }

    currentDraft.nameSyncPending = currentDraft.nameSyncPending || currentDraft.currentName !== collectionValidation.name;
    currentDraft.currentName = collectionValidation.name;
    currentDraft.nameManual = true;
    createNameInput.value = collectionValidation.name;
    const jsonValidation = validateCreateDraftNow(true);
    if (!jsonValidation || !jsonValidation.valid) {
      createJsonInput.focus();
      return;
    }
    createInFlight = true;
    setCreateControlsDisabled(true);
    createDialog.setAttribute("aria-busy", "true");
    setMessage(createNameError, "");
    setMessage(createSaveError, "");

    const finalTimestamp = dependencies.now().toISOString();
    const preset: Preset = {
      id: dependencies.randomUUID(),
      name: collectionValidation.name,
      createdAt: finalTimestamp,
      updatedAt: finalTimestamp,
      filters: jsonValidation.filters
    };

    void dependencies.store
      .savePreset(pageKey, preset, {
        uniqueNormalizedName: normalizePresetName(collectionValidation.name)
      })
      .then((nextCollection) => {
        renderCollection(nextCollection, preset.id);
        closeCreateDialog(false);
        createDialog.removeAttribute("aria-busy");
        renderResult(result, createResultLine("Preset created.", "normal"));
        applyButton.focus();
      })
      .catch((error: unknown) => {
        if (isPresetNameConflict(error)) {
          setMessage(createNameError, errorMessage(error));
          createNameInput.focus();
        } else {
          setMessage(createSaveError, errorMessage(error));
        }
      })
      .finally(() => {
        if (dialogState.active === "create") {
          createInFlight = false;
          setCreateControlsDisabled(false);
          createDialog.removeAttribute("aria-busy");
          formatCreateJsonButton.disabled = !createDraft?.validation.valid;
        }
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
        renderResult(result, createResultLine("Select a preset first.", "error"));
        updateSelectedActionStates();
        return;
      }

      openEditDialog(preset);
    });
  });

  editNameInput.addEventListener("input", () => {
    if (!editDraft || editInFlight) {
      return;
    }

    editDraft.currentName = editNameInput.value;
    setMessage(editNameError, "");
    setMessage(editSaveError, "");

    if (editDraft.validation.valid) {
      applyEditValidationResult(
        {
          ...editDraft.validation,
          normalizedPreset: {
            ...editDraft.validation.normalizedPreset,
            name: editDraft.currentName
          },
          synchronizedText: resetEditPresetJson(
            {
              ...editDraft.originalPreset,
              filters: editDraft.validation.filters
            },
            editDraft.currentName
          ),
          formattedText: resetEditPresetJson(
            {
              ...editDraft.originalPreset,
              filters: editDraft.validation.filters
            },
            editDraft.currentName
          )
        },
        resetEditPresetJson(
          {
            ...editDraft.originalPreset,
            filters: editDraft.validation.filters
          },
          editDraft.currentName
        )
      );
      editDraft.nameSyncPending = false;
      return;
    }

    editDraft.nameSyncPending = true;
  });

  saveNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !saveInFlight) {
      event.preventDefault();
      confirmSaveButton.click();
    }
  });

  editNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !editInFlight) {
      event.preventDefault();
      confirmEditButton.click();
    }
  });

  editJsonInput.addEventListener("input", () => {
    if (!editDraft || editInFlight) {
      return;
    }

    editDraft.jsonText = editJsonInput.value;
    setMessage(editSaveError, "");
    scheduleEditValidation();
  });

  formatEditJsonButton.addEventListener("click", () => {
    if (!editDraft || editInFlight || !editDraft.validation.valid) {
      return;
    }

    const formattedText = formatEditPresetJson(editJsonInput.value, {
      preset: editDraft.originalPreset,
      authoritativeName: editDraft.currentName
    });
    applyEditValidationResult(editDraft.validation, formattedText);
  });

  resetEditJsonButton.addEventListener("click", () => {
    if (!editDraft || editInFlight) {
      return;
    }

    if (editJsonInput.value === resetEditPresetJson(editDraft.originalPreset, editDraft.currentName)) {
      const resetText = resetEditPresetJson(editDraft.originalPreset, editDraft.currentName);
      applyEditValidationResult(
        validateEditPresetJson(resetText, {
          preset: editDraft.originalPreset,
          authoritativeName: editDraft.currentName
        }),
        resetText
      );
      editJsonInput.focus();
      return;
    }

    openResetDialog();
  });

  cancelEditButton.addEventListener("click", () => {
    if (!editInFlight) {
      closeEditDialog(true);
    }
  });

  confirmEditButton.addEventListener("click", () => {
    if (!editDraft || editInFlight) {
      return;
    }

    clearEditValidationTimer();
    const currentDraft = editDraft;
    const collectionValidation = validatePresetName(editNameInput.value, { schemaVersion: 1, pageKey, presets: currentPresets }, currentDraft.originalPreset.id);
    if (!collectionValidation.valid) {
      setMessage(editNameError, collectionValidation.error);
      editNameInput.focus();
      return;
    }

    currentDraft.nameSyncPending = currentDraft.nameSyncPending || currentDraft.currentName !== collectionValidation.name;
    currentDraft.currentName = collectionValidation.name;
    const jsonValidation = validateEditPresetJson(editJsonInput.value, {
      preset: currentDraft.originalPreset,
      authoritativeName: currentDraft.currentName,
      allowNameMismatch: currentDraft.nameSyncPending
    });
    if (!jsonValidation.valid) {
      applyEditValidationResult(jsonValidation);
      editJsonInput.focus();
      return;
    }

    applyEditValidationResult(jsonValidation, jsonValidation.synchronizedText);
    editInFlight = true;
    setEditControlsDisabled(true);
    editDialog.setAttribute("aria-busy", "true");
    setMessage(editNameError, "");
    setMessage(editSaveError, "");

    void dependencies.store
      .savePreset(
        pageKey,
        {
          ...jsonValidation.normalizedPreset,
          name: collectionValidation.name,
          updatedAt: dependencies.now().toISOString()
        },
        {
          requireExisting: true,
          expectedRevision: currentDraft.originalRevision,
          uniqueNormalizedName: normalizePresetName(collectionValidation.name)
        }
      )
      .then((nextCollection) => {
        renderCollection(nextCollection, currentDraft.originalPreset.id);
        closeEditDialog(false);
        editDialog.removeAttribute("aria-busy");
        renderResult(result, createResultLine("Preset updated.", "normal"));
        renameButton.focus();
      })
      .catch((error: unknown) => {
        if (isPresetNameConflict(error)) {
          setMessage(editNameError, errorMessage(error));
          editNameInput.focus();
        } else {
          setMessage(editSaveError, errorMessage(error));
        }
      })
      .finally(() => {
        if (dialogState.active === "edit") {
          editInFlight = false;
          setEditControlsDisabled(false);
          editDialog.removeAttribute("aria-busy");
          formatEditJsonButton.disabled = !editDraft?.validation.valid;
        }
      });
  });

  cancelCreateResetButton.addEventListener("click", () => {
    closeCreateResetDialog(true);
  });

  confirmCreateResetButton.addEventListener("click", () => {
    if (!createDraft) {
      return;
    }
    const resetText = createCreatePresetDocument(createDraft.provisionalPreset);
    closeCreateResetDialog(false);
    createDraft.currentName = "";
    createDraft.nameManual = false;
    createDraft.nameSyncPending = false;
    createNameInput.value = "";
    applyCreateValidationResult(
      validateCreatePresetJson(resetText, {
        provisionalPreset: createDraft.provisionalPreset,
        authoritativeName: ""
      }),
      resetText
    );
    createJsonInput.focus();
  });

  cancelEditResetButton.addEventListener("click", () => {
    closeResetDialog(true);
  });

  confirmEditResetButton.addEventListener("click", () => {
    if (!editDraft) {
      return;
    }
    const resetText = resetEditPresetJson(editDraft.originalPreset, editDraft.currentName);
    closeResetDialog(false);
    applyEditValidationResult(
      validateEditPresetJson(resetText, {
        preset: editDraft.originalPreset,
        authoritativeName: editDraft.currentName
      }),
      resetText
    );
    editJsonInput.focus();
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
        renderResult(result, createResultLine("Preset deleted.", "normal"));

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
      const operationInFlight = saveInFlight || createInFlight || editInFlight || deleteInFlight;
      event.preventDefault();
      if (operationInFlight) {
        return;
      }
      if (dialogState.active === "save") {
        closeSaveDialog(true);
      } else if (dialogState.active === "create") {
        closeCreateDialog(true);
      } else if (dialogState.active === "createReset") {
        closeCreateResetDialog(true);
      } else if (dialogState.active === "edit") {
        closeEditDialog(true);
      } else if (dialogState.active === "editReset") {
        closeResetDialog(true);
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
    readClipboardText: () => {
      if (!navigator.clipboard?.readText) {
        throw new Error("Clipboard access is unavailable.");
      }
      return navigator.clipboard.readText();
    },
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID()
  };

  mountPopup(app, dependencies).catch((error: unknown) => {
    app.textContent = errorMessage(error);
  });
}
