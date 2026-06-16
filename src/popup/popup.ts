import "./popup.css";
import popupMarkup from "./popup.html?raw";
import { getActiveTab, sendContentRequestToActiveTab } from "./contentMessaging";
import { createCreateDialogController } from "./createDialogController";
import { createDeleteDialogController } from "./deleteDialogController";
import { getPopupElements } from "./popupElements";
import { createPopupDialogState } from "./popupDialogState";
import {
  applyPresetJsonValidation,
  createPresetJsonDraft,
  markPresetJsonNameChanged,
  markPresetJsonTextChanged,
  resetPresetJsonNameSync,
  type EditPresetJsonDraft
} from "./presetJsonDraft";
import { normalizePresetName, validatePresetName } from "./presetNameValidation";
import { createApplyResultLines, createResultLine, renderResult } from "./resultLog";
import { createSaveReviewDialogController } from "./saveReviewDialogController";
import {
  createEditPresetDocument,
  formatEditPresetJson,
  resetEditPresetJson,
  validateEditPresetJson,
  type EditPresetJsonResult
} from "../shared/presetJsonEditor";
import { serializePresetExport } from "../shared/presetExport";
import { createPresetRevision } from "../shared/presetRevision";
import { createPresetStore, type PresetStore } from "../shared/presetStore";
import type { PagePresetCollection, Preset, SendContentRequest } from "../shared/types";
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

type ActiveDialog = "save" | "create" | "createReset" | "edit" | "editReset" | "delete";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Popup action failed.";
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
  let editDraft: EditPresetJsonDraft | undefined;
  let captureInFlight = false;
  let editInFlight = false;
  let editValidationTimer: number | undefined;
  let editValidationToken = 0;
  let editResetRestoreFocusTarget: HTMLElement | undefined;
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

  const deleteDialogController = createDeleteDialogController({
    elements: {
      triggerButton: deleteButton,
      presetSelect,
      saveButton,
      dialog: deleteDialog,
      presetName: deletePresetName,
      error: deleteError,
      cancelButton: cancelDeleteButton,
      confirmButton: confirmDeleteButton
    },
    getCurrentPresets: () => currentPresets,
    getSelectedPreset: selectedPreset,
    isOpenBlocked: () => captureInFlight || Boolean(dialogState.active),
    openDialog: () => openDialog("delete"),
    closeDialog: () => closeDialog("delete"),
    renderMissingSelection: () => {
      renderResult(result, createResultLine("Select a preset first.", "error"));
    },
    updateSelectedActionStates,
    deletePreset: (presetId) => dependencies.store.deletePreset(pageKey, presetId),
    renderCollection,
    renderDeleted: () => {
      renderResult(result, createResultLine("Preset deleted.", "normal"));
    },
    errorMessage
  });

  const saveReviewDialogController = createSaveReviewDialogController({
    elements: {
      triggerButton: saveButton,
      applyButton,
      dialog: saveDialog,
      nameInput: saveNameInput,
      nameError: saveNameError,
      storageError: saveStorageError,
      reviewList,
      reviewEmpty,
      selectionCount: reviewSelectionCount,
      selectionGuidance: reviewSelectionGuidance,
      selectAllButton,
      clearAllButton,
      cancelButton: cancelSaveButton,
      confirmButton: confirmSaveButton
    },
    now: dependencies.now,
    randomUUID: dependencies.randomUUID,
    getCollection: () => dependencies.store.getPageCollection(pageKey),
    savePreset: (preset, options) => dependencies.store.savePreset(pageKey, preset, options),
    openDialog: () => openDialog("save"),
    closeDialog: () => closeDialog("save"),
    renderCollection,
    renderSaved: (filterCount) => {
      renderResult(result, createResultLine(`Saved ${filterCount} filters.`, "normal"));
    },
    errorMessage
  });

  const createDialogController = createCreateDialogController({
    elements: {
      triggerButton: createButton,
      applyButton,
      dialog: createDialog,
      nameInput: createNameInput,
      nameError: createNameError,
      jsonInput: createJsonInput,
      validation: createValidation,
      saveError: createSaveError,
      pasteJsonButton: pasteCreateJsonButton,
      formatJsonButton: formatCreateJsonButton,
      resetJsonButton: resetCreateJsonButton,
      cancelButton: cancelCreateButton,
      confirmButton: confirmCreateButton,
      resetDialog: createResetDialog,
      cancelResetButton: cancelCreateResetButton,
      confirmResetButton: confirmCreateResetButton
    },
    now: dependencies.now,
    randomUUID: dependencies.randomUUID,
    readClipboardText: dependencies.readClipboardText,
    getCurrentCollection: () => ({ schemaVersion: 1, pageKey, presets: currentPresets }),
    savePreset: (preset, options) => dependencies.store.savePreset(pageKey, preset, options),
    isOpenBlocked: () => captureInFlight || Boolean(dialogState.active),
    isDialogActive: (dialog) => dialogState.active === dialog,
    openDialog: (dialog) => openDialog(dialog),
    closeDialog: (dialog) => closeDialog(dialog),
    renderCollection,
    renderCreated: () => {
      renderResult(result, createResultLine("Preset created.", "normal"));
    },
    errorMessage
  });

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

    editDraft = applyPresetJsonValidation(editDraft, validation, nextText);
    if (nextText !== undefined) {
      editJsonInput.value = nextText;
    } else {
      editDraft = markPresetJsonTextChanged(editDraft, editJsonInput.value);
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
      preset: editDraft.preset,
      authoritativeName: editDraft.currentName,
      allowNameMismatch: allowPendingNameSync
    });

    if (validation.valid) {
      editDraft = resetPresetJsonNameSync(editDraft);
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
    editDraft = createPresetJsonDraft({
      kind: "edit",
      preset,
      originalRevision: createPresetRevision(preset),
      currentName: preset.name.trim(),
      jsonText,
      validation: validateEditPresetJson(jsonText, {
        preset,
        authoritativeName: preset.name.trim()
      })
    });

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
        saveReviewDialogController.open(response.filters);
      })
      .catch((error: unknown) => {
        renderResult(result, createResultLine(errorMessage(error), "error"));
      })
      .finally(() => {
        setCaptureBusy(false);
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

  createButton.addEventListener("click", createDialogController.open);

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

    const nextEditName = editNameInput.value;
    setMessage(editNameError, "");
    setMessage(editSaveError, "");

    if (editDraft.validation.valid) {
      const synchronizedText = resetEditPresetJson(
        {
          ...editDraft.preset,
          filters: editDraft.validation.filters
        },
        nextEditName
      );
      editDraft = markPresetJsonNameChanged(editDraft, {
        name: nextEditName,
        synchronizedText
      });
      applyEditValidationResult(
        editDraft.validation,
        synchronizedText
      );
      return;
    }

    editDraft = markPresetJsonNameChanged(editDraft, { name: nextEditName });
  });

  saveNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !saveReviewDialogController.isInFlight()) {
      event.preventDefault();
      saveReviewDialogController.confirm();
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

    editDraft = markPresetJsonTextChanged(editDraft, editJsonInput.value);
    setMessage(editSaveError, "");
    scheduleEditValidation();
  });

  formatEditJsonButton.addEventListener("click", () => {
    if (!editDraft || editInFlight || !editDraft.validation.valid) {
      return;
    }

    const formattedText = formatEditPresetJson(editJsonInput.value, {
      preset: editDraft.preset,
      authoritativeName: editDraft.currentName
    });
    applyEditValidationResult(editDraft.validation, formattedText);
  });

  resetEditJsonButton.addEventListener("click", () => {
    if (!editDraft || editInFlight) {
      return;
    }

    if (editJsonInput.value === resetEditPresetJson(editDraft.preset, editDraft.currentName)) {
      const resetText = resetEditPresetJson(editDraft.preset, editDraft.currentName);
      applyEditValidationResult(
        validateEditPresetJson(resetText, {
          preset: editDraft.preset,
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
    const collectionValidation = validatePresetName(editNameInput.value, { schemaVersion: 1, pageKey, presets: currentPresets }, currentDraft.preset.id);
    if (!collectionValidation.valid) {
      setMessage(editNameError, collectionValidation.error);
      editNameInput.focus();
      return;
    }

    editDraft = markPresetJsonNameChanged(currentDraft, {
      name: collectionValidation.name,
      nameSyncPending: currentDraft.nameSyncPending || currentDraft.currentName !== collectionValidation.name
    });
    const jsonValidation = validateEditPresetJson(editJsonInput.value, {
      preset: currentDraft.preset,
      authoritativeName: collectionValidation.name,
      allowNameMismatch: editDraft.nameSyncPending
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
        renderCollection(nextCollection, currentDraft.preset.id);
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

  cancelEditResetButton.addEventListener("click", () => {
    closeResetDialog(true);
  });

  confirmEditResetButton.addEventListener("click", () => {
    if (!editDraft) {
      return;
    }
    const resetText = resetEditPresetJson(editDraft.preset, editDraft.currentName);
    closeResetDialog(false);
    applyEditValidationResult(
      validateEditPresetJson(resetText, {
        preset: editDraft.preset,
        authoritativeName: editDraft.currentName
      }),
      resetText
    );
    editJsonInput.focus();
  });

  deleteButton.addEventListener("click", deleteDialogController.open);
  cancelDeleteButton.addEventListener("click", () => {
    deleteDialogController.close(true);
  });
  confirmDeleteButton.addEventListener("click", deleteDialogController.confirm);

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
      const operationInFlight =
        saveReviewDialogController.isInFlight() ||
        createDialogController.isInFlight() ||
        editInFlight ||
        deleteDialogController.isInFlight();
      event.preventDefault();
      if (operationInFlight) {
        return;
      }
      if (dialogState.active === "save") {
        saveReviewDialogController.close(true);
      } else if (dialogState.active === "create") {
        createDialogController.close(true);
      } else if (dialogState.active === "createReset") {
        createDialogController.closeReset(true);
      } else if (dialogState.active === "edit") {
        closeEditDialog(true);
      } else if (dialogState.active === "editReset") {
        closeResetDialog(true);
      } else {
        deleteDialogController.close(true);
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
