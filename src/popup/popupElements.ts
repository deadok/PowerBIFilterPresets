export type PopupElements = {
  popupContent: HTMLDivElement;
  pageStatus: HTMLParagraphElement;
  saveButton: HTMLButtonElement;
  helpButton: HTMLButtonElement;
  createButton: HTMLButtonElement;
  applyButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  renameButton: HTMLButtonElement;
  deleteButton: HTMLButtonElement;
  selectedActionButtons: {
    apply: HTMLButtonElement;
    export: HTMLButtonElement;
    rename: HTMLButtonElement;
    delete: HTMLButtonElement;
  };
  presetSelect: HTMLSelectElement;
  result: HTMLOutputElement;
  modalBackdrop: HTMLDivElement;
  helpDialog: HTMLElement;
  closeHelpButton: HTMLButtonElement;
  saveDialog: HTMLElement;
  saveNameInput: HTMLInputElement;
  saveNameError: HTMLParagraphElement;
  saveStorageError: HTMLParagraphElement;
  reviewList: HTMLDivElement;
  reviewEmpty: HTMLParagraphElement;
  reviewSelectionCount: HTMLParagraphElement;
  reviewSelectionGuidance: HTMLParagraphElement;
  selectAllButton: HTMLButtonElement;
  clearAllButton: HTMLButtonElement;
  cancelSaveButton: HTMLButtonElement;
  confirmSaveButton: HTMLButtonElement;
  createDialog: HTMLElement;
  createNameInput: HTMLInputElement;
  createNameError: HTMLParagraphElement;
  createJsonInput: HTMLTextAreaElement;
  createValidation: HTMLParagraphElement;
  createSaveError: HTMLParagraphElement;
  pasteCreateJsonButton: HTMLButtonElement;
  formatCreateJsonButton: HTMLButtonElement;
  resetCreateJsonButton: HTMLButtonElement;
  cancelCreateButton: HTMLButtonElement;
  confirmCreateButton: HTMLButtonElement;
  editDialog: HTMLElement;
  editNameInput: HTMLInputElement;
  editNameError: HTMLParagraphElement;
  editJsonInput: HTMLTextAreaElement;
  editValidation: HTMLParagraphElement;
  editSaveError: HTMLParagraphElement;
  formatEditJsonButton: HTMLButtonElement;
  resetEditJsonButton: HTMLButtonElement;
  cancelEditButton: HTMLButtonElement;
  confirmEditButton: HTMLButtonElement;
  createResetDialog: HTMLElement;
  cancelCreateResetButton: HTMLButtonElement;
  confirmCreateResetButton: HTMLButtonElement;
  editResetDialog: HTMLElement;
  cancelEditResetButton: HTMLButtonElement;
  confirmEditResetButton: HTMLButtonElement;
  deleteDialog: HTMLElement;
  deletePresetName: HTMLElement;
  deleteError: HTMLParagraphElement;
  cancelDeleteButton: HTMLButtonElement;
  confirmDeleteButton: HTMLButtonElement;
  iconButtons: HTMLButtonElement[];
};

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Popup markup is missing ${selector}.`);
  }
  return element;
}

export function getPopupElements(root: ParentNode): PopupElements {
  const applyButton = requiredElement<HTMLButtonElement>(root, "#apply-preset");
  const exportButton = requiredElement<HTMLButtonElement>(root, "#export-preset");
  const renameButton = requiredElement<HTMLButtonElement>(root, "#rename-preset");
  const deleteButton = requiredElement<HTMLButtonElement>(root, "#delete-preset");

  return {
    popupContent: requiredElement<HTMLDivElement>(root, ".popup-content"),
    pageStatus: requiredElement<HTMLParagraphElement>(root, "#page-status"),
    saveButton: requiredElement<HTMLButtonElement>(root, "#save-current"),
    helpButton: requiredElement<HTMLButtonElement>(root, "#show-help"),
    createButton: requiredElement<HTMLButtonElement>(root, "#create-preset"),
    applyButton,
    exportButton,
    renameButton,
    deleteButton,
    selectedActionButtons: {
      apply: applyButton,
      export: exportButton,
      rename: renameButton,
      delete: deleteButton
    },
    presetSelect: requiredElement<HTMLSelectElement>(root, "#preset-select"),
    result: requiredElement<HTMLOutputElement>(root, "#result"),
    modalBackdrop: requiredElement<HTMLDivElement>(root, ".modal-backdrop"),
    helpDialog: requiredElement<HTMLElement>(root, "#help-dialog"),
    closeHelpButton: requiredElement<HTMLButtonElement>(root, "#close-help"),
    saveDialog: requiredElement<HTMLElement>(root, "#save-review-dialog"),
    saveNameInput: requiredElement<HTMLInputElement>(root, "#save-name"),
    saveNameError: requiredElement<HTMLParagraphElement>(root, "#save-name-error"),
    saveStorageError: requiredElement<HTMLParagraphElement>(root, "#save-storage-error"),
    reviewList: requiredElement<HTMLDivElement>(root, "#review-filter-list"),
    reviewEmpty: requiredElement<HTMLParagraphElement>(root, "#review-empty"),
    reviewSelectionCount: requiredElement<HTMLParagraphElement>(root, "#review-selection-count"),
    reviewSelectionGuidance: requiredElement<HTMLParagraphElement>(root, "#review-selection-guidance"),
    selectAllButton: requiredElement<HTMLButtonElement>(root, "#select-all-filters"),
    clearAllButton: requiredElement<HTMLButtonElement>(root, "#clear-all-filters"),
    cancelSaveButton: requiredElement<HTMLButtonElement>(root, "#cancel-save"),
    confirmSaveButton: requiredElement<HTMLButtonElement>(root, "#confirm-save"),
    createDialog: requiredElement<HTMLElement>(root, "#create-preset-dialog"),
    createNameInput: requiredElement<HTMLInputElement>(root, "#create-preset-name"),
    createNameError: requiredElement<HTMLParagraphElement>(root, "#create-preset-name-error"),
    createJsonInput: requiredElement<HTMLTextAreaElement>(root, "#create-preset-json"),
    createValidation: requiredElement<HTMLParagraphElement>(root, "#create-preset-validation"),
    createSaveError: requiredElement<HTMLParagraphElement>(root, "#create-preset-save-error"),
    pasteCreateJsonButton: requiredElement<HTMLButtonElement>(root, "#paste-create-preset-json"),
    formatCreateJsonButton: requiredElement<HTMLButtonElement>(root, "#format-create-preset-json"),
    resetCreateJsonButton: requiredElement<HTMLButtonElement>(root, "#reset-create-preset-json"),
    cancelCreateButton: requiredElement<HTMLButtonElement>(root, "#cancel-create-preset"),
    confirmCreateButton: requiredElement<HTMLButtonElement>(root, "#confirm-create-preset"),
    editDialog: requiredElement<HTMLElement>(root, "#edit-preset-dialog"),
    editNameInput: requiredElement<HTMLInputElement>(root, "#edit-preset-name"),
    editNameError: requiredElement<HTMLParagraphElement>(root, "#edit-preset-name-error"),
    editJsonInput: requiredElement<HTMLTextAreaElement>(root, "#edit-preset-json"),
    editValidation: requiredElement<HTMLParagraphElement>(root, "#edit-preset-validation"),
    editSaveError: requiredElement<HTMLParagraphElement>(root, "#edit-preset-save-error"),
    formatEditJsonButton: requiredElement<HTMLButtonElement>(root, "#format-edit-preset-json"),
    resetEditJsonButton: requiredElement<HTMLButtonElement>(root, "#reset-edit-preset-json"),
    cancelEditButton: requiredElement<HTMLButtonElement>(root, "#cancel-edit-preset"),
    confirmEditButton: requiredElement<HTMLButtonElement>(root, "#confirm-edit-preset"),
    createResetDialog: requiredElement<HTMLElement>(root, "#reset-create-preset-dialog"),
    cancelCreateResetButton: requiredElement<HTMLButtonElement>(root, "#cancel-reset-create-preset"),
    confirmCreateResetButton: requiredElement<HTMLButtonElement>(root, "#confirm-reset-create-preset"),
    editResetDialog: requiredElement<HTMLElement>(root, "#reset-edit-preset-dialog"),
    cancelEditResetButton: requiredElement<HTMLButtonElement>(root, "#cancel-reset-edit-preset"),
    confirmEditResetButton: requiredElement<HTMLButtonElement>(root, "#confirm-reset-edit-preset"),
    deleteDialog: requiredElement<HTMLElement>(root, ".delete-dialog"),
    deletePresetName: requiredElement<HTMLElement>(root, "#delete-preset-name"),
    deleteError: requiredElement<HTMLParagraphElement>(root, "#delete-error"),
    cancelDeleteButton: requiredElement<HTMLButtonElement>(root, "#cancel-delete"),
    confirmDeleteButton: requiredElement<HTMLButtonElement>(root, "#confirm-delete"),
    iconButtons: Array.from(root.querySelectorAll<HTMLButtonElement>(".icon-button"))
  };
}
