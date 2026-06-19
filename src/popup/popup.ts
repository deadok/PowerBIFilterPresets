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
import { formatPageStatus, formatSavedFilterCount } from "../shared/i18n/format";
import { getMessage, type MessageKey } from "../shared/i18n/messages";
import { serializePresetExport } from "../shared/presetExport";
import { createPresetStore, type PresetStore } from "../shared/presetStore";
import type { PagePresetCollection, Preset, SendContentRequest } from "../shared/types";
import { normalizePageUrl } from "../shared/url";

type PopupDependencies = {
  store: PresetStore;
  uiStorage: {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
  getActiveTab: typeof getActiveTab;
  sendContentRequest: SendContentRequest;
  readClipboardText: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  now: () => Date;
  randomUUID: () => string;
};

type ActiveDialog =
  | "siteAccessRecommendation"
  | "help"
  | "save"
  | "create"
  | "createReset"
  | "edit"
  | "editReset"
  | "delete";

const siteAccessRecommendationKey = "popup.siteAccessRecommendation.v1.dismissed";

function errorDetail(error: unknown): string | undefined {
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }

  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
}

function formatPopupError(messageKey: MessageKey, error: unknown): string {
  const detail = errorDetail(error);
  return detail ? getMessage(messageKey, [detail]) : getMessage("popupActionFailed");
}

function errorMessage(error: unknown): string {
  return errorDetail(error) ?? getMessage("popupActionFailed");
}

async function hasDismissedSiteAccessRecommendation(
  storage: PopupDependencies["uiStorage"]
): Promise<boolean> {
  const result = await storage.get(siteAccessRecommendationKey);
  return result[siteAccessRecommendationKey] === true;
}

async function dismissSiteAccessRecommendation(storage: PopupDependencies["uiStorage"]): Promise<void> {
  await storage.set({ [siteAccessRecommendationKey]: true });
}

function runPopupAction(element: HTMLOutputElement, action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    renderResult(element, createResultLine(formatPopupError("popupActionFailedWithDetail", error), "error"));
  });
}

function localizePopupMarkup(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-i18n]"))) {
    const key = element.getAttribute("data-i18n");
    if (!key) {
      continue;
    }
    element.textContent = getMessage(key as MessageKey);
  }

  const localizedAttributes = [
    ["aria-label", "data-i18n-aria-label"],
    ["title", "data-i18n-title"],
    ["data-tooltip", "data-i18n-data-tooltip"]
  ] as const;

  for (const [attributeName, keyAttribute] of localizedAttributes) {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>(`[${keyAttribute}]`))) {
      const key = element.getAttribute(keyAttribute);
      if (!key) {
        continue;
      }
      element.setAttribute(attributeName, getMessage(key as MessageKey));
    }
  }
}

export async function mountPopup(app: HTMLDivElement, dependencies: PopupDependencies): Promise<void> {
  app.innerHTML = popupMarkup;
  localizePopupMarkup(app);

  const {
    popupContent,
    pageStatus,
    saveButton,
    helpButton,
    siteAccessRecommendationDialog,
    dismissSiteAccessRecommendationButton,
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
    deleteDescription,
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
      siteAccessRecommendation: siteAccessRecommendationDialog,
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

    pageStatus.textContent = formatPageStatus(currentPresets.length);
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

  let siteAccessRecommendationDismissalInFlight = false;

  function setSiteAccessRecommendationBusy(busy: boolean): void {
    siteAccessRecommendationDismissalInFlight = busy;
    dismissSiteAccessRecommendationButton.disabled = busy;
    if (busy) {
      siteAccessRecommendationDialog.setAttribute("aria-busy", "true");
    } else {
      siteAccessRecommendationDialog.removeAttribute("aria-busy");
    }
  }

  function openSiteAccessRecommendation(): void {
    if (captureInFlight || dialogState.active || !openDialog("siteAccessRecommendation")) {
      return;
    }
    dismissSiteAccessRecommendationButton.focus();
  }

  function closeSiteAccessRecommendation(restoreFocus: boolean): void {
    const wasActive = dialogState.active === "siteAccessRecommendation";
    closeDialog("siteAccessRecommendation");
    if (!wasActive) {
      return;
    }
    if (restoreFocus) {
      saveButton.focus();
    }
  }

  async function handleSiteAccessRecommendationDismiss(): Promise<void> {
    if (siteAccessRecommendationDismissalInFlight) {
      return;
    }

    setSiteAccessRecommendationBusy(true);
    try {
      await dismissSiteAccessRecommendation(dependencies.uiStorage);
      closeSiteAccessRecommendation(true);
    } catch (error: unknown) {
      closeSiteAccessRecommendation(true);
      renderResult(result, createResultLine(getMessage("popupSiteAccessReminderSaveFailed", [errorMessage(error)]), "error"));
    } finally {
      setSiteAccessRecommendationBusy(false);
    }
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
      description: deleteDescription,
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
      renderResult(result, createResultLine(getMessage("popupSelectPresetFirst"), "error"));
    },
    updateSelectedActionStates,
    renderDescription: (presetName) => getMessage("popupDeleteDialogDescription", [presetName]),
    deletePreset: (presetId) => dependencies.store.deletePreset(pageKey, presetId),
    renderCollection,
    renderDeleted: () => {
      renderResult(result, createResultLine(getMessage("popupPresetDeleted"), "normal"));
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
      renderResult(result, createResultLine(formatSavedFilterCount(filterCount), "normal"));
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
      renderResult(result, createResultLine(getMessage("popupPresetCreated"), "normal"));
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
      renderResult(result, createResultLine(getMessage("popupPresetUpdated"), "normal"));
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
    renderResult(result, createResultLine(getMessage("popupReadingFilters"), "normal"));

    void dependencies
      .sendContentRequest({ type: "READ_FILTERS" })
      .then((response) => {
        if (!response.ok || !("filters" in response)) {
          renderResult(
            result,
            createResultLine(
              response.ok ? getMessage("popupNoFiltersReturned") : formatPopupError("popupReadFiltersFailedWithDetail", response.error),
              "error"
            )
          );
          return;
        }
        saveReviewDialogController.open(response.filters);
      })
      .catch((error: unknown) => {
        renderResult(result, createResultLine(formatPopupError("popupReadFiltersFailedWithDetail", error), "error"));
      })
      .finally(() => {
        setCaptureBusy(false);
      });
  });

  applyButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const preset = await storedSelectedPreset();
      if (!preset) {
        renderResult(result, createResultLine(getMessage("popupSelectPresetFirst"), "error"));
        updateSelectedActionStates();
        return;
      }

      renderResult(result, createResultLine(getMessage("popupApplyingPreset"), "normal"));
      const response = await dependencies.sendContentRequest({ type: "APPLY_FILTERS", filters: preset.filters });

      if (!response.ok || !("results" in response)) {
        renderResult(
          result,
          createResultLine(
            response.ok ? getMessage("popupNoResultsReturned") : formatPopupError("popupApplyPresetFailedWithDetail", response.error),
            "error"
          )
        );
        return;
      }

      renderResult(result, createApplyResultLines(response.results));
    });
  });

  exportButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const preset = await storedSelectedPreset();
      if (!preset) {
        renderResult(result, createResultLine(getMessage("popupSelectPresetFirst"), "error"));
        updateSelectedActionStates();
        return;
      }

      await dependencies.writeClipboard(serializePresetExport(preset));
      renderResult(result, createResultLine(getMessage("popupPresetJsonCopied"), "normal"));
    });
  });

  helpButton.addEventListener("click", openHelp);
  dismissSiteAccessRecommendationButton.addEventListener("click", () => {
    void handleSiteAccessRecommendationDismiss();
  });
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
        renderResult(result, createResultLine(getMessage("popupSelectPresetFirst"), "error"));
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
      } else if (dialogState.active === "siteAccessRecommendation") {
        if (!siteAccessRecommendationDismissalInFlight) {
          void handleSiteAccessRecommendationDismiss();
        }
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
  if (!(await hasDismissedSiteAccessRecommendation(dependencies.uiStorage))) {
    openSiteAccessRecommendation();
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  const dependencies: PopupDependencies = {
    store: createPresetStore(),
    uiStorage: chrome.storage.local,
    getActiveTab,
    sendContentRequest: sendContentRequestToActiveTab,
    readClipboardText: () => {
      if (!navigator.clipboard?.readText) {
        return Promise.reject(new Error(getMessage("popupClipboardUnavailable")));
      }
      return navigator.clipboard.readText();
    },
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID()
  };

  mountPopup(app, dependencies).catch((error: unknown) => {
    app.textContent = formatPopupError("popupPopupLoadFailedWithDetail", error);
  });
}
