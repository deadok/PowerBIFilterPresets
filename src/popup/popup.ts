import "./popup.css";
import popupMarkup from "./popup.html?raw";
import { getActiveTab, sendContentRequestToActiveTab } from "./contentMessaging";
import { createCreateDialogController } from "./createDialogController";
import { createDeleteDialogController } from "./deleteDialogController";
import { createEditDialogController } from "./editDialogController";
import { getPopupElements } from "./popupElements";
import { createPopupDialogState } from "./popupDialogState";
import { createApplyResultLines, createResultLine, renderResult } from "./resultLog";
import { createSaveReviewDialogController } from "./saveReviewDialogController";
import { serializePresetExport } from "../shared/presetExport";
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

type ActiveDialog = "help" | "save" | "create" | "createReset" | "edit" | "editReset" | "delete";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Popup action failed.";
}

function runPopupAction(element: HTMLOutputElement, action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    renderResult(element, createResultLine(errorMessage(error), "error"));
  });
}

export async function mountPopup(app: HTMLDivElement, dependencies: PopupDependencies): Promise<void> {
  app.innerHTML = popupMarkup;

  const {
    popupContent,
    pageStatus,
    saveButton,
    helpButton,
    createButton,
    applyButton,
    exportButton,
    renameButton,
    deleteButton,
    selectedActionButtons,
    presetSelect,
    result,
    modalBackdrop,
    helpDialog,
    closeHelpButton,
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
  let captureInFlight = false;
  const dialogState = createPopupDialogState<ActiveDialog>({
    background: popupContent,
    backdrop: modalBackdrop,
    dialogs: {
      help: helpDialog,
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
    if (
      kind === "help" ||
      kind === "save" ||
      kind === "create" ||
      kind === "createReset" ||
      kind === "edit" ||
      kind === "editReset"
    ) {
      document.body.classList.add("review-open");
      modalBackdrop.classList.add("review-backdrop");
    }
    return true;
  }

  function closeDialog(kind: ActiveDialog): void {
    if (!dialogState.close(kind)) {
      return;
    }
    if (
      kind === "help" ||
      kind === "save" ||
      kind === "create" ||
      kind === "createReset" ||
      kind === "edit" ||
      kind === "editReset"
    ) {
      document.body.classList.remove("review-open");
      modalBackdrop.classList.remove("review-backdrop");
    }
  }

  function openHelp(): void {
    if (captureInFlight || dialogState.active || !openDialog("help")) {
      return;
    }
    closeHelpButton.focus();
  }

  function closeHelp(restoreFocus: boolean): void {
    const wasActive = dialogState.active === "help";
    closeDialog("help");
    if (!wasActive) {
      return;
    }
    if (restoreFocus) {
      helpButton.focus();
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

  const editDialogController = createEditDialogController({
    elements: {
      triggerButton: renameButton,
      dialog: editDialog,
      nameInput: editNameInput,
      nameError: editNameError,
      jsonInput: editJsonInput,
      validation: editValidation,
      saveError: editSaveError,
      formatJsonButton: formatEditJsonButton,
      resetJsonButton: resetEditJsonButton,
      cancelButton: cancelEditButton,
      confirmButton: confirmEditButton,
      resetDialog: editResetDialog,
      cancelResetButton: cancelEditResetButton,
      confirmResetButton: confirmEditResetButton
    },
    now: dependencies.now,
    getCurrentCollection: () => ({ schemaVersion: 1, pageKey, presets: currentPresets }),
    savePreset: (preset, options) => dependencies.store.savePreset(pageKey, preset, options),
    isDialogActive: (dialog) => dialogState.active === dialog,
    openDialog: (dialog) => openDialog(dialog),
    closeDialog: (dialog) => closeDialog(dialog),
    renderCollection,
    renderUpdated: () => {
      renderResult(result, createResultLine("Preset updated.", "normal"));
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

  helpButton.addEventListener("click", openHelp);
  closeHelpButton.addEventListener("click", () => {
    closeHelp(true);
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

      editDialogController.open(preset);
    });
  });

  saveNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !saveReviewDialogController.isInFlight()) {
      event.preventDefault();
      saveReviewDialogController.confirm();
    }
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
        editDialogController.isInFlight() ||
        deleteDialogController.isInFlight();
      event.preventDefault();
      if (operationInFlight) {
        return;
      }
      if (dialogState.active === "save") {
        saveReviewDialogController.close(true);
      } else if (dialogState.active === "help") {
        closeHelp(true);
      } else if (dialogState.active === "create") {
        createDialogController.close(true);
      } else if (dialogState.active === "createReset") {
        createDialogController.closeReset(true);
      } else if (dialogState.active === "edit") {
        editDialogController.close(true);
      } else if (dialogState.active === "editReset") {
        editDialogController.closeReset(true);
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
        return Promise.reject(new Error("Clipboard access is unavailable."));
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
