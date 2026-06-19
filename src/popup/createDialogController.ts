import {
  applyPresetJsonValidation,
  createPresetJsonDraft,
  markPresetJsonNameChanged,
  markPresetJsonTextChanged,
  resetPresetJsonNameSync,
  type CreatePresetJsonDraft
} from "./presetJsonDraft";
import { normalizePresetName, validatePresetName } from "./presetNameValidation";
import {
  createCreatePresetDocument,
  formatCreatePresetJson,
  resetCreatePresetJson,
  sanitizeImportedPresetDocument,
  validateCreatePresetJson,
  type CreatePresetJsonResult
} from "../shared/presetJsonEditor";
import { getMessage } from "../shared/i18n/messages";
import type { PagePresetCollection, Preset } from "../shared/types";

type CreateDialogName = "create" | "createReset";

export type CreateDialogElements = {
  triggerButton: HTMLButtonElement;
  applyButton: HTMLButtonElement;
  dialog: HTMLElement;
  nameInput: HTMLInputElement;
  nameError: HTMLElement;
  jsonInput: HTMLTextAreaElement;
  validation: HTMLElement;
  saveError: HTMLElement;
  pasteJsonButton: HTMLButtonElement;
  formatJsonButton: HTMLButtonElement;
  resetJsonButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  confirmButton: HTMLButtonElement;
  resetDialog: HTMLElement;
  cancelResetButton: HTMLButtonElement;
  confirmResetButton: HTMLButtonElement;
};

export type CreateDialogController = {
  open: () => void;
  close: (restoreFocus: boolean) => void;
  closeReset: (restoreFocus: boolean) => void;
  confirm: () => void;
  isInFlight: () => boolean;
};

type CreateDialogControllerOptions = {
  elements: CreateDialogElements;
  now: () => Date;
  randomUUID: () => string;
  readClipboardText: () => Promise<string>;
  getCurrentCollection: () => PagePresetCollection;
  savePreset: (preset: Preset, options: { uniqueNormalizedName: string }) => Promise<PagePresetCollection>;
  isOpenBlocked: () => boolean;
  isDialogActive: (dialog: CreateDialogName) => boolean;
  openDialog: (dialog: CreateDialogName) => boolean;
  closeDialog: (dialog: CreateDialogName) => void;
  renderCollection: (collection: PagePresetCollection, selectedPresetId?: string) => void;
  renderCreated: () => void;
  errorMessage: (error: unknown) => string;
};

function setMessage(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = message.length === 0;
}

function clipboardReadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError") {
      return getMessage("createDialogClipboardDenied");
    }
    return error.message || getMessage("createDialogClipboardReadFailed");
  }

  return getMessage("createDialogClipboardReadFailed");
}

function isPresetNameConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "PresetNameConflictError";
}

export function createCreateDialogController(options: CreateDialogControllerOptions): CreateDialogController {
  const { elements } = options;
  let draft: CreatePresetJsonDraft | undefined;
  let inFlight = false;
  let validationTimer: number | undefined;
  let validationToken = 0;
  let sessionToken = 0;
  let resetRestoreFocusTarget: HTMLElement | undefined;

  function renderValidationMessage(message: string, invalid: boolean): void {
    elements.validation.textContent = message;
    elements.validation.classList.toggle("is-invalid", invalid);
  }

  function setControlsDisabled(disabled: boolean): void {
    elements.nameInput.disabled = disabled;
    elements.jsonInput.disabled = disabled;
    elements.pasteJsonButton.disabled = disabled;
    elements.formatJsonButton.disabled = disabled;
    elements.resetJsonButton.disabled = disabled;
    elements.cancelButton.disabled = disabled;
    elements.confirmButton.disabled = disabled;
  }

  function clearValidationTimer(): void {
    if (validationTimer !== undefined) {
      window.clearTimeout(validationTimer);
      validationTimer = undefined;
    }
  }

  function applyValidationResult(validation: CreatePresetJsonResult, nextText?: string): void {
    if (!draft) {
      return;
    }

    draft = applyPresetJsonValidation(draft, validation, nextText);
    if (nextText !== undefined) {
      elements.jsonInput.value = nextText;
    } else {
      draft = markPresetJsonTextChanged(draft, elements.jsonInput.value);
    }

    if (validation.valid) {
      renderValidationMessage(getMessage("jsonValidationValid"), false);
      setMessage(elements.saveError, "");
    } else {
      renderValidationMessage(validation.error.message, true);
    }

    elements.pasteJsonButton.disabled = inFlight;
    elements.formatJsonButton.disabled = inFlight || !validation.valid;
    elements.resetJsonButton.disabled = inFlight;
    elements.confirmButton.disabled = inFlight;
  }

  function validateDraftNow(allowPendingNameSync: boolean): CreatePresetJsonResult | undefined {
    if (!draft) {
      return undefined;
    }

    let nextText = elements.jsonInput.value;
    let authoritativeName = draft.currentName;
    let allowNameMismatch = allowPendingNameSync;
    const imported = sanitizeImportedPresetDocument(nextText, {
      provisionalPreset: draft.preset
    });
    if (imported.valid) {
      nextText = imported.text;
      if (!draft.nameManual) {
        authoritativeName = imported.adoptedName;
        draft = markPresetJsonNameChanged(draft, {
          name: authoritativeName,
          nameManual: false,
          synchronizedText: nextText
        });
        elements.nameInput.value = authoritativeName;
      } else {
        allowNameMismatch = true;
      }
    }

    const validation = validateCreatePresetJson(nextText, {
      provisionalPreset: draft.preset,
      authoritativeName,
      allowNameMismatch
    });

    if (validation.valid) {
      draft = resetPresetJsonNameSync(draft);
      applyValidationResult(validation, validation.synchronizedText);
    } else {
      applyValidationResult(validation, imported.valid ? imported.text : undefined);
    }

    return validation;
  }

  function scheduleValidation(): void {
    if (!draft) {
      return;
    }

    clearValidationTimer();
    const token = ++validationToken;
    const currentSessionToken = draft.sessionToken;
    validationTimer = window.setTimeout(() => {
      if (!draft || !options.isDialogActive("create") || token !== validationToken || draft.sessionToken !== currentSessionToken) {
        return;
      }
      validateDraftNow(draft.nameSyncPending);
    }, 250);
  }

  function resetDraftState(): void {
    clearValidationTimer();
    validationToken += 1;
    draft = undefined;
    inFlight = false;
    elements.nameInput.value = "";
    elements.jsonInput.value = "";
    setControlsDisabled(false);
    setMessage(elements.nameError, "");
    setMessage(elements.saveError, "");
    renderValidationMessage("", false);
  }

  function open(): void {
    if (options.isOpenBlocked()) {
      return;
    }

    const now = options.now().toISOString();
    const provisionalPreset: Preset = {
      id: options.randomUUID(),
      name: "",
      createdAt: now,
      updatedAt: now,
      filters: []
    };
    const jsonText = createCreatePresetDocument(provisionalPreset);
    draft = createPresetJsonDraft({
      kind: "create",
      preset: provisionalPreset,
      currentName: "",
      jsonText,
      validation: validateCreatePresetJson(jsonText, {
        provisionalPreset,
        authoritativeName: ""
      }),
      nameManual: false,
      sessionToken: ++sessionToken
    });

    elements.nameInput.value = "";
    elements.jsonInput.value = jsonText;
    setMessage(elements.nameError, "");
    setMessage(elements.saveError, "");
    setControlsDisabled(false);
    applyValidationResult(draft.validation, jsonText);
    if (!options.openDialog("create")) {
      draft = undefined;
      return;
    }
    elements.nameInput.focus();
  }

  function close(restoreFocus: boolean): void {
    if (inFlight) {
      return;
    }

    options.closeDialog("create");
    resetDraftState();
    if (restoreFocus) {
      elements.triggerButton.focus();
    }
  }

  function openReset(): void {
    if (!draft || inFlight) {
      return;
    }

    resetRestoreFocusTarget = elements.resetJsonButton;
    options.closeDialog("create");
    if (!options.openDialog("createReset")) {
      options.openDialog("create");
      return;
    }
    elements.cancelResetButton.focus();
  }

  function closeReset(restoreFocus: boolean): void {
    options.closeDialog("createReset");
    if (draft) {
      options.openDialog("create");
    }
    if (restoreFocus) {
      (resetRestoreFocusTarget ?? elements.resetJsonButton).focus();
    }
    resetRestoreFocusTarget = undefined;
  }

  function confirm(): void {
    if (!draft || inFlight) {
      return;
    }

    clearValidationTimer();
    const currentDraft = draft;
    const collectionValidation = validatePresetName(elements.nameInput.value, options.getCurrentCollection());
    if (!collectionValidation.valid) {
      setMessage(elements.nameError, collectionValidation.error);
      elements.nameInput.focus();
      return;
    }

    draft = markPresetJsonNameChanged(currentDraft, {
      name: collectionValidation.name,
      nameManual: true,
      nameSyncPending: currentDraft.nameSyncPending || currentDraft.currentName !== collectionValidation.name
    });
    elements.nameInput.value = collectionValidation.name;
    const jsonValidation = validateDraftNow(true);
    if (!jsonValidation || !jsonValidation.valid) {
      elements.jsonInput.focus();
      return;
    }
    inFlight = true;
    setControlsDisabled(true);
    elements.dialog.setAttribute("aria-busy", "true");
    setMessage(elements.nameError, "");
    setMessage(elements.saveError, "");

    const finalTimestamp = options.now().toISOString();
    const preset: Preset = {
      id: options.randomUUID(),
      name: collectionValidation.name,
      createdAt: finalTimestamp,
      updatedAt: finalTimestamp,
      filters: jsonValidation.filters
    };

    void options
      .savePreset(preset, {
        uniqueNormalizedName: normalizePresetName(collectionValidation.name)
      })
      .then((nextCollection) => {
        options.renderCollection(nextCollection, preset.id);
        options.closeDialog("create");
        resetDraftState();
        elements.dialog.removeAttribute("aria-busy");
        options.renderCreated();
        elements.applyButton.focus();
      })
      .catch((error: unknown) => {
        if (isPresetNameConflict(error)) {
          setMessage(elements.nameError, options.errorMessage(error));
          elements.nameInput.focus();
        } else {
          setMessage(elements.saveError, options.errorMessage(error));
        }
      })
      .finally(() => {
        if (draft) {
          inFlight = false;
          setControlsDisabled(false);
          elements.dialog.removeAttribute("aria-busy");
          elements.formatJsonButton.disabled = !draft.validation.valid;
        }
      });
  }

  elements.nameInput.addEventListener("input", () => {
    if (!draft || inFlight) {
      return;
    }

    const nextCreateName = elements.nameInput.value;
    setMessage(elements.nameError, "");
    setMessage(elements.saveError, "");

    if (draft.validation.valid) {
      const synchronizedText = resetCreatePresetJson(
        {
          ...draft.preset,
          filters: draft.validation.filters
        },
        nextCreateName
      );
      draft = markPresetJsonNameChanged(draft, {
        name: nextCreateName,
        nameManual: true,
        synchronizedText
      });
      applyValidationResult(draft.validation, synchronizedText);
      return;
    }

    draft = markPresetJsonNameChanged(draft, {
      name: nextCreateName,
      nameManual: true
    });
  });

  elements.nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !inFlight) {
      event.preventDefault();
      confirm();
    }
  });

  elements.jsonInput.addEventListener("input", () => {
    if (!draft || inFlight) {
      return;
    }

    draft = markPresetJsonTextChanged(draft, elements.jsonInput.value);
    setMessage(elements.saveError, "");
    scheduleValidation();
  });

  elements.pasteJsonButton.addEventListener("click", () => {
    if (!draft || inFlight) {
      return;
    }

    const currentSessionToken = draft.sessionToken;
    setMessage(elements.saveError, "");

    void options
      .readClipboardText()
      .then((text) => {
        if (!draft || !options.isDialogActive("create") || draft.sessionToken !== currentSessionToken) {
          return;
        }
        if (text.length === 0) {
          renderValidationMessage(getMessage("createDialogClipboardEmpty"), true);
          return;
        }

        const imported = sanitizeImportedPresetDocument(text, {
          provisionalPreset: draft.preset
        });
        if (!imported.valid) {
          renderValidationMessage(imported.error.message, true);
          return;
        }

        if (!draft.nameManual) {
          draft = markPresetJsonNameChanged(draft, {
            name: imported.adoptedName,
            nameManual: false,
            synchronizedText: imported.text
          });
          elements.nameInput.value = imported.adoptedName;
        }

        const validation = validateCreatePresetJson(imported.text, {
          provisionalPreset: draft.preset,
          authoritativeName: draft.currentName,
          allowNameMismatch: draft.nameManual
        });
        if (validation.valid) {
          draft = resetPresetJsonNameSync(draft);
          applyValidationResult(validation, validation.synchronizedText);
        } else {
          draft = markPresetJsonNameChanged(draft, {
            name: draft.currentName,
            nameManual: draft.nameManual
          });
          applyValidationResult(validation, imported.text);
        }
      })
      .catch((error: unknown) => {
        if (!draft || !options.isDialogActive("create") || draft.sessionToken !== currentSessionToken) {
          return;
        }
        renderValidationMessage(clipboardReadErrorMessage(error), true);
      });
  });

  elements.formatJsonButton.addEventListener("click", () => {
    if (!draft || inFlight || !draft.validation.valid) {
      return;
    }

    const formattedText = formatCreatePresetJson(elements.jsonInput.value, {
      provisionalPreset: draft.preset,
      authoritativeName: draft.currentName
    });
    applyValidationResult(draft.validation, formattedText);
  });

  elements.resetJsonButton.addEventListener("click", () => {
    if (!draft || inFlight) {
      return;
    }

    const resetText = createCreatePresetDocument(draft.preset);
    if (elements.jsonInput.value === resetText && elements.nameInput.value.length === 0 && !draft.nameManual) {
      applyValidationResult(
        validateCreatePresetJson(resetText, {
          provisionalPreset: draft.preset,
          authoritativeName: ""
        }),
        resetText
      );
      elements.jsonInput.focus();
      return;
    }

    openReset();
  });

  elements.cancelButton.addEventListener("click", () => {
    close(true);
  });

  elements.confirmButton.addEventListener("click", confirm);

  elements.cancelResetButton.addEventListener("click", () => {
    closeReset(true);
  });

  elements.confirmResetButton.addEventListener("click", () => {
    if (!draft) {
      return;
    }
    const resetText = createCreatePresetDocument(draft.preset);
    closeReset(false);
    draft = resetPresetJsonNameSync(
      markPresetJsonNameChanged(draft, {
        name: "",
        nameManual: false,
        synchronizedText: resetText
      })
    );
    elements.nameInput.value = "";
    applyValidationResult(
      validateCreatePresetJson(resetText, {
        provisionalPreset: draft.preset,
        authoritativeName: ""
      }),
      resetText
    );
    elements.jsonInput.focus();
  });

  return {
    open,
    close,
    closeReset,
    confirm,
    isInFlight: () => inFlight
  };
}
