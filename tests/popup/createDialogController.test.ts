import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCreateDialogController } from "../../src/popup/createDialogController";
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
    <button id="create-preset">Create</button>
    <button id="apply-preset">Apply</button>
    <section id="create-preset-dialog" hidden tabindex="-1">
      <input id="create-preset-name" />
      <p id="create-preset-name-error" hidden></p>
      <textarea id="create-preset-json"></textarea>
      <p id="create-preset-validation"></p>
      <p id="create-preset-save-error" hidden></p>
      <button id="paste-create-preset-json">Paste JSON</button>
      <button id="format-create-preset-json">Format JSON</button>
      <button id="reset-create-preset-json">Reset</button>
      <button id="cancel-create-preset">Cancel</button>
      <button id="confirm-create-preset">Create preset</button>
    </section>
    <section id="reset-create-preset-dialog" hidden tabindex="-1">
      <button id="cancel-reset-create-preset">Cancel reset</button>
      <button id="confirm-reset-create-preset">Reset JSON</button>
    </section>
  `;

  return {
    triggerButton: document.querySelector<HTMLButtonElement>("#create-preset")!,
    applyButton: document.querySelector<HTMLButtonElement>("#apply-preset")!,
    dialog: document.querySelector<HTMLElement>("#create-preset-dialog")!,
    nameInput: document.querySelector<HTMLInputElement>("#create-preset-name")!,
    nameError: document.querySelector<HTMLParagraphElement>("#create-preset-name-error")!,
    jsonInput: document.querySelector<HTMLTextAreaElement>("#create-preset-json")!,
    validation: document.querySelector<HTMLParagraphElement>("#create-preset-validation")!,
    saveError: document.querySelector<HTMLParagraphElement>("#create-preset-save-error")!,
    pasteJsonButton: document.querySelector<HTMLButtonElement>("#paste-create-preset-json")!,
    formatJsonButton: document.querySelector<HTMLButtonElement>("#format-create-preset-json")!,
    resetJsonButton: document.querySelector<HTMLButtonElement>("#reset-create-preset-json")!,
    cancelButton: document.querySelector<HTMLButtonElement>("#cancel-create-preset")!,
    confirmButton: document.querySelector<HTMLButtonElement>("#confirm-create-preset")!,
    resetDialog: document.querySelector<HTMLElement>("#reset-create-preset-dialog")!,
    cancelResetButton: document.querySelector<HTMLButtonElement>("#cancel-reset-create-preset")!,
    confirmResetButton: document.querySelector<HTMLButtonElement>("#confirm-reset-create-preset")!
  };
}

describe("createCreateDialogController", () => {
  beforeEach(() => {
    installTestMessages(
      {
        jsonValidationValid: "Validation passed.",
        createDialogClipboardDenied: "Clipboard permission was denied.",
        createDialogClipboardReadFailed: "Clipboard text could not be read."
      } as Parameters<typeof installTestMessages>[0]
    );
  });

  afterEach(() => {
    resetTestMessages();
  });

  it("opens with a provisional JSON document and resets local draft state", () => {
    const elements = createFixture();
    const controller = createCreateDialogController({
      elements,
      now: () => new Date("2026-06-16T10:00:00.000Z"),
      randomUUID: () => "created",
      readClipboardText: vi.fn(),
      getCurrentCollection: () => collection([]),
      savePreset: vi.fn(),
      isOpenBlocked: () => false,
      isDialogActive: (dialog) => !(dialog === "create" ? elements.dialog : elements.resetDialog).hidden,
      openDialog: (dialog) => {
        (dialog === "create" ? elements.dialog : elements.resetDialog).hidden = false;
        return true;
      },
      closeDialog: (dialog) => {
        (dialog === "create" ? elements.dialog : elements.resetDialog).hidden = true;
      },
      renderCollection: vi.fn(),
      renderCreated: vi.fn(),
      errorMessage: String
    });

    controller.open();

    expect(elements.dialog.hidden).toBe(false);
    expect(elements.nameInput.value).toBe("");
    expect(elements.validation.textContent).toBe("preset.filters: Add at least one filter.");
    expect(JSON.parse(elements.jsonInput.value)).toMatchObject({
      schemaVersion: 1,
      preset: {
        id: "created",
        name: "",
        createdAt: "2026-06-16T10:00:00.000Z",
        updatedAt: "2026-06-16T10:00:00.000Z",
        filters: []
      }
    });
    expect(document.activeElement).toBe(elements.nameInput);

    elements.nameInput.value = "Draft";
    elements.nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    elements.resetJsonButton.click();
    elements.confirmResetButton.click();

    expect(elements.nameInput.value).toBe("");
    expect(document.activeElement).toBe(elements.jsonInput);
  });

  it("creates a preset once and preserves the draft after storage failure", async () => {
    const elements = createFixture();
    const savedCollection = collection([preset("created", "Created from JSON")]);
    const savePreset = vi.fn().mockRejectedValueOnce(new Error("Storage unavailable.")).mockResolvedValueOnce(savedCollection);
    const renderCollection = vi.fn();
    const renderCreated = vi.fn();
    const controller = createCreateDialogController({
      elements,
      now: () => new Date("2026-06-16T10:00:00.000Z"),
      randomUUID: () => "created",
      readClipboardText: vi.fn(),
      getCurrentCollection: () => collection([]),
      savePreset,
      isOpenBlocked: () => false,
      isDialogActive: (dialog) => !(dialog === "create" ? elements.dialog : elements.resetDialog).hidden,
      openDialog: (dialog) => {
        (dialog === "create" ? elements.dialog : elements.resetDialog).hidden = false;
        return true;
      },
      closeDialog: (dialog) => {
        (dialog === "create" ? elements.dialog : elements.resetDialog).hidden = true;
      },
      renderCollection,
      renderCreated,
      errorMessage: (error) => (error instanceof Error ? error.message : String(error))
    });

    controller.open();
    elements.nameInput.value = "Created from JSON";
    elements.nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    const documentJson = JSON.parse(elements.jsonInput.value) as { preset: Preset };
    documentJson.preset.filters = [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }];
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
    expect(elements.nameInput.value).toBe("Created from JSON");

    controller.confirm();

    await vi.waitFor(() => {
      expect(savePreset).toHaveBeenCalledTimes(2);
      expect(renderCollection).toHaveBeenCalledWith(savedCollection, "created");
      expect(renderCreated).toHaveBeenCalledOnce();
      expect(elements.dialog.hidden).toBe(true);
    });
    expect(document.activeElement).toBe(elements.applyButton);
  });

  it("shows localized clipboard and JSON validation messages", async () => {
    const elements = createFixture();
    const controller = createCreateDialogController({
      elements,
      now: () => new Date("2026-06-16T10:00:00.000Z"),
      randomUUID: () => "created",
      readClipboardText: vi.fn().mockRejectedValue(Object.assign(new Error("Denied"), { name: "NotAllowedError" })),
      getCurrentCollection: () => collection([]),
      savePreset: vi.fn(),
      isOpenBlocked: () => false,
      isDialogActive: (dialog) => !(dialog === "create" ? elements.dialog : elements.resetDialog).hidden,
      openDialog: (dialog) => {
        (dialog === "create" ? elements.dialog : elements.resetDialog).hidden = false;
        return true;
      },
      closeDialog: (dialog) => {
        (dialog === "create" ? elements.dialog : elements.resetDialog).hidden = true;
      },
      renderCollection: vi.fn(),
      renderCreated: vi.fn(),
      errorMessage: (error) => (error instanceof Error ? error.message : String(error))
    });

    controller.open();
    const documentJson = JSON.parse(elements.jsonInput.value) as { preset: Preset };
    documentJson.preset.filters = [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }];
    elements.jsonInput.value = JSON.stringify(documentJson, null, 2);
    elements.jsonInput.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(elements.validation.textContent).toBe("Validation passed.");
    });

    elements.pasteJsonButton.click();

    await vi.waitFor(() => {
      expect(elements.validation.textContent).toBe("Clipboard permission was denied.");
    });
    expect(elements.validation.innerHTML).not.toContain("<strong>");
  });
});
