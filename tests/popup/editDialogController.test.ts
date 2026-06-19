import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditDialogController } from "../../src/popup/editDialogController";
import { installTestMessages, resetTestMessages } from "../../src/shared/i18n/messages";
import type { PagePresetCollection, Preset } from "../../src/shared/types";

function preset(id: string, name: string): Preset {
  return {
    id,
    name,
    createdAt: "2026-06-09T10:00:00.000Z",
    updatedAt: "2026-06-09T10:00:00.000Z",
    filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
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
    <button id="rename-preset">Edit</button>
    <section id="edit-preset-dialog" hidden tabindex="-1">
      <input id="edit-preset-name" />
      <p id="edit-preset-name-error" hidden></p>
      <textarea id="edit-preset-json"></textarea>
      <p id="edit-preset-validation"></p>
      <p id="edit-preset-save-error" hidden></p>
      <button id="format-edit-preset-json">Format JSON</button>
      <button id="reset-edit-preset-json">Reset</button>
      <button id="cancel-edit-preset">Cancel</button>
      <button id="confirm-edit-preset">Save changes</button>
    </section>
    <section id="reset-edit-preset-dialog" hidden tabindex="-1">
      <button id="cancel-reset-edit-preset">Cancel reset</button>
      <button id="confirm-reset-edit-preset">Reset JSON</button>
    </section>
  `;

  return {
    triggerButton: document.querySelector<HTMLButtonElement>("#rename-preset")!,
    dialog: document.querySelector<HTMLElement>("#edit-preset-dialog")!,
    nameInput: document.querySelector<HTMLInputElement>("#edit-preset-name")!,
    nameError: document.querySelector<HTMLParagraphElement>("#edit-preset-name-error")!,
    jsonInput: document.querySelector<HTMLTextAreaElement>("#edit-preset-json")!,
    validation: document.querySelector<HTMLParagraphElement>("#edit-preset-validation")!,
    saveError: document.querySelector<HTMLParagraphElement>("#edit-preset-save-error")!,
    formatJsonButton: document.querySelector<HTMLButtonElement>("#format-edit-preset-json")!,
    resetJsonButton: document.querySelector<HTMLButtonElement>("#reset-edit-preset-json")!,
    cancelButton: document.querySelector<HTMLButtonElement>("#cancel-edit-preset")!,
    confirmButton: document.querySelector<HTMLButtonElement>("#confirm-edit-preset")!,
    resetDialog: document.querySelector<HTMLElement>("#reset-edit-preset-dialog")!,
    cancelResetButton: document.querySelector<HTMLButtonElement>("#cancel-reset-edit-preset")!,
    confirmResetButton: document.querySelector<HTMLButtonElement>("#confirm-reset-edit-preset")!
  };
}

describe("createEditDialogController", () => {
  beforeEach(() => {
    installTestMessages({
      jsonValidationValid: "Validation passed."
    } as Parameters<typeof installTestMessages>[0]);
  });

  afterEach(() => {
    resetTestMessages();
  });

  it("opens an existing preset and restores reset focus without saving", () => {
    const elements = createFixture();
    const existing = preset("one", "Sales review");
    const controller = createEditDialogController({
      elements,
      now: () => new Date("2026-06-16T10:00:00.000Z"),
      getCurrentCollection: () => collection([existing]),
      savePreset: vi.fn(),
      isDialogActive: (dialog) => !(dialog === "edit" ? elements.dialog : elements.resetDialog).hidden,
      openDialog: (dialog) => {
        (dialog === "edit" ? elements.dialog : elements.resetDialog).hidden = false;
        return true;
      },
      closeDialog: (dialog) => {
        (dialog === "edit" ? elements.dialog : elements.resetDialog).hidden = true;
      },
      renderCollection: vi.fn(),
      renderUpdated: vi.fn(),
      errorMessage: String
    });

    controller.open(existing);

    expect(elements.dialog.hidden).toBe(false);
    expect(elements.nameInput.value).toBe("Sales review");
    expect(elements.validation.textContent).toBe("Validation passed.");
    expect(JSON.parse(elements.jsonInput.value)).toMatchObject({
      schemaVersion: 1,
      preset: {
        id: "one",
        name: "Sales review",
        filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
      }
    });
    expect(document.activeElement).toBe(elements.nameInput);

    elements.jsonInput.value = elements.jsonInput.value.replace('"EMEA"', '"North"');
    elements.jsonInput.dispatchEvent(new Event("input", { bubbles: true }));
    elements.resetJsonButton.click();
    expect(elements.resetDialog.hidden).toBe(false);
    expect(document.activeElement).toBe(elements.cancelResetButton);

    elements.cancelResetButton.click();
    expect(elements.dialog.hidden).toBe(false);
    expect(document.activeElement).toBe(elements.resetJsonButton);
  });

  it("updates a preset once and preserves the draft after storage failure", async () => {
    const elements = createFixture();
    const existing = preset("one", "Sales review");
    const savedCollection = collection([preset("one", "Renamed")]);
    const savePreset = vi.fn().mockRejectedValueOnce(new Error("Storage unavailable.")).mockResolvedValueOnce(savedCollection);
    const renderCollection = vi.fn();
    const renderUpdated = vi.fn();
    const controller = createEditDialogController({
      elements,
      now: () => new Date("2026-06-16T10:00:00.000Z"),
      getCurrentCollection: () => collection([existing]),
      savePreset,
      isDialogActive: (dialog) => !(dialog === "edit" ? elements.dialog : elements.resetDialog).hidden,
      openDialog: (dialog) => {
        (dialog === "edit" ? elements.dialog : elements.resetDialog).hidden = false;
        return true;
      },
      closeDialog: (dialog) => {
        (dialog === "edit" ? elements.dialog : elements.resetDialog).hidden = true;
      },
      renderCollection,
      renderUpdated,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error))
    });

    controller.open(existing);
    elements.nameInput.value = "Renamed";
    elements.nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    const documentJson = JSON.parse(elements.jsonInput.value) as { preset: Preset };
    documentJson.preset.filters = [{ title: "Region", type: "list", selectedLabels: ["North"] }];
    elements.jsonInput.value = JSON.stringify(documentJson, null, 2);
    elements.jsonInput.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(elements.validation.textContent).toBe("Validation passed.");
    });

    controller.confirm();

    await vi.waitFor(() => {
      expect(elements.saveError.textContent).toBe("Storage unavailable.");
    });
    expect(elements.dialog.hidden).toBe(false);
    expect(elements.nameInput.disabled).toBe(false);
    expect(elements.nameInput.value).toBe("Renamed");
    expect(elements.jsonInput.value).toContain('"North"');

    controller.confirm();

    await vi.waitFor(() => {
      expect(savePreset).toHaveBeenCalledTimes(2);
      expect(savePreset).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "one", name: "Renamed", updatedAt: "2026-06-16T10:00:00.000Z" }),
        expect.objectContaining({
          requireExisting: true,
          expectedRevision: expect.any(String),
          uniqueNormalizedName: "renamed"
        })
      );
      expect(renderCollection).toHaveBeenCalledWith(savedCollection, "one");
      expect(renderUpdated).toHaveBeenCalledOnce();
      expect(elements.dialog.hidden).toBe(true);
    });
    expect(document.activeElement).toBe(elements.triggerButton);
  });
});
