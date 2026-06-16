import { describe, expect, it, vi } from "vitest";
import { createDeleteDialogController } from "../../src/popup/deleteDialogController";
import type { PagePresetCollection, Preset } from "../../src/shared/types";

function preset(id: string, name: string): Preset {
  return {
    id,
    name,
    createdAt: "2026-06-09T10:00:00.000Z",
    updatedAt: "2026-06-09T10:00:00.000Z",
    filters: []
  };
}

function collection(presets: Preset[]): PagePresetCollection {
  return {
    schemaVersion: 1,
    pageKey: "https://portal.example/report",
    presets
  };
}

function createFixture() {
  document.body.innerHTML = `
    <button id="delete-preset">Delete</button>
    <select id="preset-select"></select>
    <button id="save-current">Save</button>
    <section class="delete-dialog" hidden tabindex="-1">
      <span id="delete-preset-name"></span>
      <p id="delete-error" hidden></p>
      <button id="cancel-delete">Cancel</button>
      <button id="confirm-delete">Delete preset</button>
    </section>
  `;

  return {
    triggerButton: document.querySelector<HTMLButtonElement>("#delete-preset")!,
    presetSelect: document.querySelector<HTMLSelectElement>("#preset-select")!,
    saveButton: document.querySelector<HTMLButtonElement>("#save-current")!,
    dialog: document.querySelector<HTMLElement>(".delete-dialog")!,
    presetName: document.querySelector<HTMLElement>("#delete-preset-name")!,
    error: document.querySelector<HTMLParagraphElement>("#delete-error")!,
    cancelButton: document.querySelector<HTMLButtonElement>("#cancel-delete")!,
    confirmButton: document.querySelector<HTMLButtonElement>("#confirm-delete")!
  };
}

describe("createDeleteDialogController", () => {
  it("opens and cancels the delete confirmation with local state reset", () => {
    const elements = createFixture();
    const presets = [preset("one", "Sales review")];
    const openDialog = vi.fn(() => {
      elements.dialog.hidden = false;
      return true;
    });
    const closeDialog = vi.fn(() => {
      elements.dialog.hidden = true;
    });

    const controller = createDeleteDialogController({
      elements,
      getCurrentPresets: () => presets,
      getSelectedPreset: () => presets[0],
      isOpenBlocked: () => false,
      openDialog,
      closeDialog,
      renderMissingSelection: vi.fn(),
      updateSelectedActionStates: vi.fn(),
      deletePreset: vi.fn(),
      renderCollection: vi.fn(),
      renderDeleted: vi.fn(),
      errorMessage: String
    });

    controller.open();

    expect(openDialog).toHaveBeenCalledOnce();
    expect(elements.presetName.textContent).toBe("“Sales review”");
    expect(elements.error.hidden).toBe(true);
    expect(document.activeElement).toBe(elements.cancelButton);

    controller.close(true);

    expect(closeDialog).toHaveBeenCalledOnce();
    expect(elements.dialog.hidden).toBe(true);
    expect(elements.presetName.textContent).toBe("“Sales review”");
    expect(elements.error.hidden).toBe(true);
    expect(controller.isInFlight()).toBe(false);
    expect(document.activeElement).toBe(elements.triggerButton);
  });

  it("confirms deletion, renders the preferred following selection, and focuses the preset select", async () => {
    const elements = createFixture();
    const presets = [preset("one", "One"), preset("two", "Two"), preset("three", "Three")];
    const nextCollection = collection([presets[0], presets[2]]);
    const deletePreset = vi.fn().mockResolvedValue(nextCollection);
    const renderCollection = vi.fn();

    const controller = createDeleteDialogController({
      elements,
      getCurrentPresets: () => presets,
      getSelectedPreset: () => presets[1],
      isOpenBlocked: () => false,
      openDialog: () => {
        elements.dialog.hidden = false;
        return true;
      },
      closeDialog: () => {
        elements.dialog.hidden = true;
      },
      renderMissingSelection: vi.fn(),
      updateSelectedActionStates: vi.fn(),
      deletePreset,
      renderCollection,
      renderDeleted: vi.fn(),
      errorMessage: String
    });

    controller.open();
    controller.confirm();

    expect(controller.isInFlight()).toBe(true);
    expect(elements.cancelButton.disabled).toBe(true);
    expect(elements.confirmButton.disabled).toBe(true);
    expect(elements.dialog.getAttribute("aria-busy")).toBe("true");

    await vi.waitFor(() => {
      expect(deletePreset).toHaveBeenCalledWith("two");
      expect(renderCollection).toHaveBeenCalledWith(nextCollection, "three");
      expect(elements.dialog.hidden).toBe(true);
    });
    expect(document.activeElement).toBe(elements.presetSelect);
  });

  it("keeps the confirmation open while deletion is in flight", async () => {
    const elements = createFixture();
    const presets = [preset("one", "One")];
    let resolveDeletion: ((value: PagePresetCollection) => void) | undefined;
    const deletePreset = vi.fn(
      () =>
        new Promise<PagePresetCollection>((resolve) => {
          resolveDeletion = resolve;
        })
    );

    const controller = createDeleteDialogController({
      elements,
      getCurrentPresets: () => presets,
      getSelectedPreset: () => presets[0],
      isOpenBlocked: () => false,
      openDialog: () => {
        elements.dialog.hidden = false;
        return true;
      },
      closeDialog: () => {
        elements.dialog.hidden = true;
      },
      renderMissingSelection: vi.fn(),
      updateSelectedActionStates: vi.fn(),
      deletePreset,
      renderCollection: vi.fn(),
      renderDeleted: vi.fn(),
      errorMessage: String
    });

    controller.open();
    controller.confirm();
    controller.close(true);

    expect(elements.dialog.hidden).toBe(false);
    expect(document.activeElement).toBe(elements.dialog);

    resolveDeletion?.(collection([]));

    await vi.waitFor(() => {
      expect(elements.dialog.hidden).toBe(true);
    });
  });
});
