import {
  applyPresetJsonValidation,
  createPresetJsonDraft,
  markPresetJsonNameChanged,
  markPresetJsonTextChanged,
  resetPresetJsonNameSync,
  type EditPresetJsonDraft
} from "./presetJsonDraft";
import { normalizePresetName, validatePresetName } from "./presetNameValidation";
import {
  createEditPresetDocument,
  formatEditPresetJson,
  resetEditPresetJson,
  validateEditPresetJson,
  type EditPresetJsonResult
} from "../shared/presetJsonEditor";
import { getMessage } from "../shared/i18n/messages";
import { createPresetRevision } from "../shared/presetRevision";
import type { PagePresetCollection, Preset } from "../shared/types";

type EditDialogName = "edit" | "editReset";

export type EditDialogElements = {
  triggerButton: HTMLButtonElement;
  dialog: HTMLElement;
  nameInput: HTMLInputElement;
  nameError: HTMLElement;
  jsonInput: HTMLTextAreaElement;
  validation: HTMLElement;
  saveError: HTMLElement;
  formatJsonButton: HTMLButtonElement;
  resetJsonButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  confirmButton: HTMLButtonElement;
  resetDialog: HTMLElement;
  cancelResetButton: HTMLButtonElement;
  confirmResetButton: HTMLButtonElement;
};

export type EditDialogController = {
  open: (preset: Preset) => void;
  close: (restoreFocus: boolean) => void;
  closeReset: (restoreFocus: boolean) => void;
  confirm: () => void;
  isInFlight: () => boolean;
};

type EditDialogControllerOptions = {
  elements: EditDialogElements;
  now: () => Date;
  getCurrentCollection: () => PagePresetCollection;
  savePreset: (
    preset: Preset,
    options: {
      requireExisting: true;
      expectedRevision: string;
      uniqueNormalizedName: string;
    }
  ) => Promise<PagePresetCollection>;
  isDialogActive: (dialog: EditDialogName) => boolean;
  openDialog: (dialog: EditDialogName) => boolean;
  closeDialog: (dialog: EditDialogName) => void;
  renderCollection: (collection: PagePresetCollection, selectedPresetId?: string) => void;
  renderUpdated: () => void;
  errorMessage: (error: unknown) => string;
};

function setMessage(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = message.length === 0;
}

function isPresetNameConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "PresetNameConflictError";
}

export function createEditDialogController(options: EditDialogControllerOptions): EditDialogController {
  const { elements } = options;
  let draft: EditPresetJsonDraft | undefined;
  let inFlight = false;
  let validationTimer: number | undefined;
  let validationToken = 0;
  let resetRestoreFocusTarget: HTMLElement | undefined;

  function renderValidationMessage(message: string, invalid: boolean): void {
    elements.validation.textContent = message;
    elements.validation.classList.toggle("is-invalid", invalid);
  }

  function setControlsDisabled(disabled: boolean): void {
    elements.nameInput.disabled = disabled;
    elements.jsonInput.disabled = disabled;
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

  function applyValidationResult(validation: EditPresetJsonResult, nextText?: string): void {
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

    elements.formatJsonButton.disabled = inFlight || !validation.valid;
    elements.resetJsonButton.disabled = inFlight;
    elements.confirmButton.disabled = inFlight;
  }

  function validateDraftNow(allowPendingNameSync: boolean): EditPresetJsonResult | undefined {
    if (!draft) {
      return undefined;
    }

    const validation = validateEditPresetJson(elements.jsonInput.value, {
      preset: draft.preset,
      authoritativeName: draft.currentName,
      allowNameMismatch: allowPendingNameSync
    });

    if (validation.valid) {
      draft = resetPresetJsonNameSync(draft);
      applyValidationResult(validation, validation.synchronizedText);
    } else {
      applyValidationResult(validation);
    }

    return validation;
  }

  function scheduleValidation(): void {
    if (!draft) {
      return;
    }

    clearValidationTimer();
    const token = ++validationToken;
    validationTimer = window.setTimeout(() => {
      if (!draft || !options.isDialogActive("edit") || token !== validationToken) {
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

  function open(preset: Preset): void {
    const jsonText = createEditPresetDocument(preset);
    draft = createPresetJsonDraft({
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

    elements.nameInput.value = draft.currentName;
    elements.jsonInput.value = jsonText;
    setMessage(elements.nameError, "");
    setMessage(elements.saveError, "");
    setControlsDisabled(false);
    applyValidationResult(draft.validation, jsonText);
    if (!options.openDialog("edit")) {
      draft = undefined;
      return;
    }
    elements.nameInput.focus();
    elements.nameInput.select();
  }

  function close(restoreFocus: boolean): void {
    if (inFlight) {
      return;
    }

    options.closeDialog("edit");
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
    options.closeDialog("edit");
    if (!options.openDialog("editReset")) {
      options.openDialog("edit");
      return;
    }
    elements.cancelResetButton.focus();
  }

  function closeReset(restoreFocus: boolean): void {
    options.closeDialog("editReset");
    if (draft) {
      options.openDialog("edit");
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
    const collectionValidation = validatePresetName(elements.nameInput.value, options.getCurrentCollection(), currentDraft.preset.id);
    if (!collectionValidation.valid) {
      setMessage(elements.nameError, collectionValidation.error);
      elements.nameInput.focus();
      return;
    }

    draft = markPresetJsonNameChanged(currentDraft, {
      name: collectionValidation.name,
      nameSyncPending: currentDraft.nameSyncPending || currentDraft.currentName !== collectionValidation.name
    });
    const jsonValidation = validateEditPresetJson(elements.jsonInput.value, {
      preset: currentDraft.preset,
      authoritativeName: collectionValidation.name,
      allowNameMismatch: draft.nameSyncPending
    });
    if (!jsonValidation.valid) {
      applyValidationResult(jsonValidation);
      elements.jsonInput.focus();
      return;
    }

    applyValidationResult(jsonValidation, jsonValidation.synchronizedText);
    inFlight = true;
    setControlsDisabled(true);
    elements.dialog.setAttribute("aria-busy", "true");
    setMessage(elements.nameError, "");
    setMessage(elements.saveError, "");

    void options
      .savePreset(
        {
          ...jsonValidation.normalizedPreset,
          name: collectionValidation.name,
          updatedAt: options.now().toISOString()
        },
        {
          requireExisting: true,
          expectedRevision: currentDraft.originalRevision,
          uniqueNormalizedName: normalizePresetName(collectionValidation.name)
        }
      )
      .then((nextCollection) => {
        options.renderCollection(nextCollection, currentDraft.preset.id);
        options.closeDialog("edit");
        resetDraftState();
        elements.dialog.removeAttribute("aria-busy");
        options.renderUpdated();
        elements.triggerButton.focus();
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

    const nextEditName = elements.nameInput.value;
    setMessage(elements.nameError, "");
    setMessage(elements.saveError, "");

    if (draft.validation.valid) {
      const synchronizedText = resetEditPresetJson(
        {
          ...draft.preset,
          filters: draft.validation.filters
        },
        nextEditName
      );
      draft = markPresetJsonNameChanged(draft, {
        name: nextEditName,
        synchronizedText
      });
      applyValidationResult(draft.validation, synchronizedText);
      return;
    }

    draft = markPresetJsonNameChanged(draft, { name: nextEditName });
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

  elements.formatJsonButton.addEventListener("click", () => {
    if (!draft || inFlight || !draft.validation.valid) {
      return;
    }

    const formattedText = formatEditPresetJson(elements.jsonInput.value, {
      preset: draft.preset,
      authoritativeName: draft.currentName
    });
    applyValidationResult(draft.validation, formattedText);
  });

  elements.resetJsonButton.addEventListener("click", () => {
    if (!draft || inFlight) {
      return;
    }

    if (elements.jsonInput.value === resetEditPresetJson(draft.preset, draft.currentName)) {
      const resetText = resetEditPresetJson(draft.preset, draft.currentName);
      applyValidationResult(
        validateEditPresetJson(resetText, {
          preset: draft.preset,
          authoritativeName: draft.currentName
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
    const resetText = resetEditPresetJson(draft.preset, draft.currentName);
    closeReset(false);
    applyValidationResult(
      validateEditPresetJson(resetText, {
        preset: draft.preset,
        authoritativeName: draft.currentName
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
