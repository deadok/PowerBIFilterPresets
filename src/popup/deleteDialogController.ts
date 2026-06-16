import type { PagePresetCollection, Preset } from "../shared/types";

type PendingDeletion = {
  id: string;
  name: string;
  index: number;
  nextId?: string;
  previousId?: string;
};

export type DeleteDialogElements = {
  triggerButton: HTMLButtonElement;
  presetSelect: HTMLSelectElement;
  saveButton: HTMLButtonElement;
  dialog: HTMLElement;
  presetName: HTMLElement;
  error: HTMLParagraphElement;
  cancelButton: HTMLButtonElement;
  confirmButton: HTMLButtonElement;
};

type DeleteDialogControllerOptions = {
  elements: DeleteDialogElements;
  getCurrentPresets: () => Preset[];
  getSelectedPreset: () => Preset | undefined;
  isOpenBlocked: () => boolean;
  openDialog: () => boolean;
  closeDialog: () => void;
  renderMissingSelection: () => void;
  updateSelectedActionStates: () => void;
  deletePreset: (presetId: string) => Promise<PagePresetCollection>;
  renderCollection: (collection: PagePresetCollection, preferredSelectionId?: string) => void;
  renderDeleted: () => void;
  errorMessage: (error: unknown) => string;
};

export type DeleteDialogController = {
  open: () => void;
  close: (restoreTriggerFocus: boolean) => void;
  confirm: () => void;
  isInFlight: () => boolean;
};

function setMessage(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = message.length === 0;
}

function selectionAfterDeletion(
  collection: PagePresetCollection,
  deletion: PendingDeletion
): string | undefined {
  const availableIds = new Set(collection.presets.map((preset) => preset.id));
  if (deletion.nextId && availableIds.has(deletion.nextId)) {
    return deletion.nextId;
  }
  if (deletion.previousId && availableIds.has(deletion.previousId)) {
    return deletion.previousId;
  }
  return collection.presets[Math.min(deletion.index, collection.presets.length - 1)]?.id;
}

export function createDeleteDialogController(
  options: DeleteDialogControllerOptions
): DeleteDialogController {
  const { elements } = options;
  let pendingDeletion: PendingDeletion | undefined;
  let deleteInFlight = false;

  function setBusy(busy: boolean): void {
    deleteInFlight = busy;
    elements.cancelButton.disabled = busy;
    elements.confirmButton.disabled = busy;
    if (busy) {
      elements.dialog.setAttribute("aria-busy", "true");
    } else {
      elements.dialog.removeAttribute("aria-busy");
    }
  }

  function resetDialog(restoreTriggerFocus: boolean): void {
    options.closeDialog();
    pendingDeletion = undefined;
    setMessage(elements.error, "");
    setBusy(false);

    if (restoreTriggerFocus) {
      elements.triggerButton.focus();
    }
  }

  function close(restoreTriggerFocus: boolean): void {
    if (deleteInFlight) {
      return;
    }

    resetDialog(restoreTriggerFocus);
  }

  function open(): void {
    if (options.isOpenBlocked() || pendingDeletion) {
      return;
    }

    const currentPresets = options.getCurrentPresets();
    const preset = options.getSelectedPreset();
    const index = preset ? currentPresets.findIndex((candidate) => candidate.id === preset.id) : -1;
    if (!preset || index < 0) {
      options.renderMissingSelection();
      options.updateSelectedActionStates();
      return;
    }

    pendingDeletion = {
      id: preset.id,
      name: preset.name,
      index,
      nextId: currentPresets[index + 1]?.id,
      previousId: currentPresets[index - 1]?.id
    };
    elements.presetName.textContent = `“${preset.name}”`;
    setMessage(elements.error, "");
    if (!options.openDialog()) {
      pendingDeletion = undefined;
      return;
    }
    elements.cancelButton.focus();
  }

  function confirm(): void {
    if (!pendingDeletion || deleteInFlight) {
      return;
    }

    const deletion = pendingDeletion;
    setBusy(true);
    elements.dialog.focus();
    setMessage(elements.error, "");

    void options
      .deletePreset(deletion.id)
      .then((collection) => {
        const preferredSelectionId = selectionAfterDeletion(collection, deletion);
        options.renderCollection(collection, preferredSelectionId);
        resetDialog(false);
        options.renderDeleted();

        if (collection.presets.length > 0) {
          elements.presetSelect.focus();
        } else {
          elements.saveButton.focus();
        }
      })
      .catch((error: unknown) => {
        setBusy(false);
        setMessage(elements.error, options.errorMessage(error));
        elements.cancelButton.focus();
      });
  }

  return {
    open,
    close,
    confirm,
    isInFlight: () => deleteInFlight
  };
}
