import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Preset } from "../../src/shared/types";

const testState = vi.hoisted(() => ({
  presets: [] as Preset[],
  getPageCollection: vi.fn(),
  savePreset: vi.fn(),
  deletePreset: vi.fn(),
  getActiveTab: vi.fn(),
  sendContentRequestToActiveTab: vi.fn()
}));

vi.mock("../../src/shared/presetStore", () => ({
  createPresetStore: () => ({
    getPageCollection: testState.getPageCollection,
    savePreset: testState.savePreset,
    deletePreset: testState.deletePreset
  })
}));

vi.mock("../../src/popup/contentMessaging", () => ({
  getActiveTab: testState.getActiveTab,
  sendContentRequestToActiveTab: testState.sendContentRequestToActiveTab
}));

const pageKey = "https://portal.example/reports/sales";

function preset(id: string, name: string): Preset {
  return {
    id,
    name,
    createdAt: "2026-06-09T10:00:00.000Z",
    updatedAt: "2026-06-09T10:00:00.000Z",
    filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
  };
}

function collection() {
  return {
    schemaVersion: 1 as const,
    pageKey,
    presets: [...testState.presets]
  };
}

async function mountPopup(presets: Preset[] = [preset("one", "Sales review")]): Promise<void> {
  testState.presets = [...presets];
  testState.getPageCollection.mockImplementation(async () => collection());
  testState.savePreset.mockImplementation(async (_key: string, nextPreset: Preset) => {
    testState.presets = [...testState.presets.filter((item) => item.id !== nextPreset.id), nextPreset];
    return collection();
  });
  testState.deletePreset.mockImplementation(async (_key: string, presetId: string) => {
    testState.presets = testState.presets.filter((item) => item.id !== presetId);
    return collection();
  });
  testState.getActiveTab.mockResolvedValue({ id: 42, url: pageKey });
  testState.sendContentRequestToActiveTab.mockResolvedValue({ ok: true, filters: [] });

  document.body.innerHTML = '<div id="app"></div>';
  await import("../../src/popup/popup");
  await vi.waitFor(() => {
    expect(document.querySelector("#page-status")?.textContent).toBe(`${presets.length} presets for this URL`);
  });
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function selectPreset(id: string): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>("#preset-select");
  if (!select) {
    throw new Error("Preset selector not found.");
  }
  select.value = id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return select;
}

function deleteButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>("#delete-preset");
  if (!button) {
    throw new Error("Delete button not found.");
  }
  return button;
}

function confirmDeleteButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>("#confirm-delete");
  if (!button) {
    throw new Error("Delete confirmation button not found.");
  }
  return button;
}

describe("popup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
  });

  it("renders the approved main action hierarchy and selected-preset states", async () => {
    await mountPopup();

    const save = document.querySelector<HTMLButtonElement>("#save-current");
    const separator = document.querySelector("hr.popup-separator");
    const label = document.querySelector<HTMLLabelElement>('label[for="preset-select"]');
    const apply = document.querySelector<HTMLButtonElement>("#apply-preset");
    const actionRow = document.querySelector(".preset-actions");

    expect(save?.classList.contains("button-secondary")).toBe(true);
    expect(save?.textContent).toContain("Save current filters");
    expect(save?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(separator?.getAttribute("aria-hidden")).toBe("true");
    expect(label?.textContent).toBe("Selected preset");
    expect(apply?.classList.contains("button-primary")).toBe(true);
    expect(apply?.textContent).toContain("Apply preset");
    expect(apply?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(actionRow?.querySelectorAll("button")).toHaveLength(3);
    expect(Array.from(actionRow?.querySelectorAll("button") ?? []).map((button) => button.id)).toEqual([
      "export-preset",
      "rename-preset",
      "delete-preset"
    ]);
    expect(apply?.disabled).toBe(false);
  });

  it("gives every icon action an accessible name and tooltip", async () => {
    await mountPopup();

    expect(document.querySelector("#export-preset")).toMatchObject({
      ariaLabel: "Copy preset JSON",
      title: "Copy preset JSON"
    });
    expect(document.querySelector("#rename-preset")).toMatchObject({
      ariaLabel: "Rename preset",
      title: "Rename preset"
    });
    expect(document.querySelector("#delete-preset")).toMatchObject({
      ariaLabel: "Delete preset",
      title: "Delete preset"
    });
  });

  it("disables selected-preset actions for an empty collection", async () => {
    await mountPopup([]);

    expect(document.querySelector<HTMLButtonElement>("#save-current")?.disabled).toBe(false);
    expect(document.querySelector<HTMLSelectElement>("#preset-select")?.options).toHaveLength(0);
    for (const id of ["apply-preset", "export-preset", "rename-preset", "delete-preset"]) {
      expect(document.querySelector<HTMLButtonElement>(`#${id}`)?.disabled).toBe(true);
    }
  });

  it("disables selected-preset actions when no option is selected", async () => {
    await mountPopup([preset("one", "One"), preset("two", "Two")]);

    const select = document.querySelector<HTMLSelectElement>("#preset-select");
    if (!select) {
      throw new Error("Preset selector not found.");
    }
    select.selectedIndex = -1;
    select.dispatchEvent(new Event("change", { bubbles: true }));

    for (const id of ["apply-preset", "export-preset", "rename-preset", "delete-preset"]) {
      expect(document.querySelector<HTMLButtonElement>(`#${id}`)?.disabled).toBe(true);
    }
  });

  it("opens one confirmation without deleting and cancels with focus restoration", async () => {
    await mountPopup([preset("one", "Очень длинное имя пресета для проверки")]);
    const trigger = deleteButton();

    click(trigger);
    click(trigger);

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.hidden).toBe(false);
    expect(dialog?.textContent).toContain("Очень длинное имя пресета для проверки");
    expect(testState.deletePreset).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(document.querySelector("#cancel-delete"));

    click(document.querySelector("#cancel-delete") as Element);

    expect(dialog?.hidden).toBe(true);
    expect(testState.deletePreset).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes confirmation on Escape and restores focus to Delete", async () => {
    await mountPopup();
    const trigger = deleteButton();
    click(trigger);

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(testState.deletePreset).not.toHaveBeenCalled();
  });

  it("traps focus inside the open confirmation", async () => {
    await mountPopup();
    click(deleteButton());
    const cancel = document.querySelector<HTMLButtonElement>("#cancel-delete");
    const confirm = confirmDeleteButton();

    confirm.focus();
    confirm.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(cancel);

    cancel?.focus();
    cancel?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(confirm);
  });

  it("selects the following preset after deleting a middle preset", async () => {
    await mountPopup([preset("one", "One"), preset("two", "Two"), preset("three", "Three")]);
    selectPreset("two");
    click(deleteButton());
    click(confirmDeleteButton());

    await vi.waitFor(() => {
      expect(testState.deletePreset).toHaveBeenCalledWith(pageKey, "two");
      expect(document.querySelector<HTMLSelectElement>("#preset-select")?.value).toBe("three");
      expect(document.querySelector("#result")?.textContent).toBe("Preset deleted.");
    });
    expect(document.activeElement).toBe(document.querySelector("#preset-select"));
  });

  it("selects the preceding preset after deleting the last preset", async () => {
    await mountPopup([preset("one", "One"), preset("two", "Two"), preset("three", "Three")]);
    selectPreset("three");
    click(deleteButton());
    click(confirmDeleteButton());

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>("#preset-select")?.value).toBe("two");
    });
  });

  it("disables actions and focuses Save after deleting the only preset", async () => {
    await mountPopup([preset("only", "Only")]);
    click(deleteButton());
    click(confirmDeleteButton());

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>("#preset-select")?.options).toHaveLength(0);
      expect(document.activeElement).toBe(document.querySelector("#save-current"));
    });
    expect(document.querySelector<HTMLButtonElement>("#apply-preset")?.disabled).toBe(true);
  });

  it("keeps the confirmation open and announces a deletion failure", async () => {
    await mountPopup();
    testState.deletePreset.mockRejectedValueOnce(new Error("Storage unavailable."));
    click(deleteButton());
    click(confirmDeleteButton());

    await vi.waitFor(() => {
      expect(document.querySelector("#delete-error")?.textContent).toBe("Storage unavailable.");
    });
    expect(document.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(false);
    expect(document.querySelector("#result")?.textContent).not.toBe("Preset deleted.");
    expect(selectPreset("one").value).toBe("one");
  });

  it("cannot dismiss a confirmed deletion while storage is pending", async () => {
    let resolveDeletion: ((value: ReturnType<typeof collection>) => void) | undefined;
    await mountPopup();
    testState.deletePreset.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDeletion = resolve;
        })
    );

    click(deleteButton());
    click(confirmDeleteButton());
    const cancel = document.querySelector<HTMLButtonElement>("#cancel-delete");
    expect(cancel?.disabled).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));

    cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(false);
    resolveDeletion?.({ ...collection(), presets: [] });

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(true);
    });
  });

  it("restores Cancel after a deletion failure", async () => {
    await mountPopup();
    testState.deletePreset.mockRejectedValueOnce(new Error("Storage unavailable."));
    click(deleteButton());
    click(confirmDeleteButton());

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLButtonElement>("#cancel-delete")?.disabled).toBe(false);
      expect(document.activeElement).toBe(document.querySelector("#cancel-delete"));
    });
  });

  it("keeps Copy JSON and Rename wired to the selected preset", async () => {
    const original = preset("one", "Sales review");
    await mountPopup([original]);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Renamed preset");

    click(document.querySelector("#export-preset") as Element);
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"name": "Sales review"'));
    });

    click(document.querySelector("#rename-preset") as Element);
    await vi.waitFor(() => {
      expect(prompt).toHaveBeenCalledWith("Preset name", "Sales review");
      expect(testState.savePreset).toHaveBeenCalledWith(
        pageKey,
        expect.objectContaining({ id: "one", name: "Renamed preset" })
      );
      expect(document.querySelector("#result")?.textContent).toBe("Preset renamed.");
    });
  });
});
