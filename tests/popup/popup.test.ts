import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FilterPresetItem, Preset } from "../../src/shared/types";

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

function filter(title: string, selectedLabels: string[]): FilterPresetItem {
  return { title, type: "list", selectedLabels };
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

function editButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>("#rename-preset");
  if (!button) {
    throw new Error("Edit button not found.");
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

async function openSaveReview(filters: FilterPresetItem[]): Promise<void> {
  testState.sendContentRequestToActiveTab.mockResolvedValueOnce({ ok: true, filters });
  click(document.querySelector("#save-current") as Element);
  await vi.waitFor(() => {
    expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(false);
  });
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
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000000");
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

  it("shows a decorative brand logo without replacing the accessible heading", async () => {
    await mountPopup();

    const header = document.querySelector(".popup-header");
    const logo = header?.querySelector<HTMLImageElement>(".popup-logo");

    expect(header?.querySelector("h1")?.textContent).toBe("Power BI Presets");
    expect(logo?.getAttribute("src")).toBe("/assets/brand/logo.png");
    expect(logo?.getAttribute("alt")).toBe("");
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives every icon action an accessible name and tooltip", async () => {
    await mountPopup();

    expect(document.querySelector("#export-preset")).toMatchObject({
      ariaLabel: "Copy preset JSON",
      title: "Copy preset JSON"
    });
    expect(document.querySelector("#rename-preset")).toMatchObject({
      ariaLabel: "Edit preset",
      title: "Edit preset"
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

    const dialog = document.querySelector<HTMLElement>(".delete-dialog");
    expect(dialog?.hidden).toBe(false);
    expect(dialog?.textContent).toContain("Очень длинное имя пресета для проверки");
    expect(testState.deletePreset).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".delete-dialog")).toHaveLength(1);
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

    expect(document.querySelector<HTMLElement>(".delete-dialog")?.hidden).toBe(true);
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
    expect(document.querySelector<HTMLElement>(".delete-dialog")?.hidden).toBe(false);
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
    expect(document.activeElement).toBe(document.querySelector(".delete-dialog"));

    cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector(".delete-dialog"));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector<HTMLElement>(".delete-dialog")?.hidden).toBe(false);
    resolveDeletion?.({ ...collection(), presets: [] });

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>(".delete-dialog")?.hidden).toBe(true);
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

    click(document.querySelector("#export-preset") as Element);
    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"name": "Sales review"'));
    });

    click(editButton());
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const nameInput = document.querySelector<HTMLInputElement>("#edit-preset-name");
    if (!nameInput) {
      throw new Error("Edit name input not found.");
    }
    nameInput.value = "Renamed preset";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    click(document.querySelector("#confirm-edit-preset") as Element);

    await vi.waitFor(() => {
      expect(testState.savePreset).toHaveBeenCalledWith(
        pageKey,
        expect.objectContaining({
          id: "one",
          name: "Renamed preset",
          createdAt: "2026-06-09T10:00:00.000Z"
        }),
        expect.objectContaining({ requireExisting: true, uniqueNormalizedName: "renamed preset" })
      );
      expect(document.querySelector("#result")?.textContent).toBe("Preset updated.");
    });
  });

  it("opens Edit preset with the selected preset name and complete export JSON", async () => {
    await mountPopup([preset("one", "Sales review")]);

    click(editButton());

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    expect(document.querySelector("#edit-preset-title")?.textContent).toBe("Edit preset");
    expect(document.querySelector<HTMLInputElement>("#edit-preset-name")?.value).toBe("Sales review");
    expect(JSON.parse(document.querySelector<HTMLTextAreaElement>("#edit-preset-json")?.value ?? "")).toEqual({
      schemaVersion: 1,
      preset: preset("one", "Sales review")
    });
  });

  it("synchronizes the name field into valid JSON and rejects direct JSON name edits", async () => {
    await mountPopup([preset("one", "Sales review")]);
    click(editButton());

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const nameInput = document.querySelector<HTMLInputElement>("#edit-preset-name");
    const jsonInput = document.querySelector<HTMLTextAreaElement>("#edit-preset-json");
    if (!nameInput || !jsonInput) {
      throw new Error("Edit controls not found.");
    }

    nameInput.value = "План продаж";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      expect(JSON.parse(jsonInput.value)).toMatchObject({
        preset: {
          name: "План продаж"
        }
      });
    });

    jsonInput.value = jsonInput.value.replace("План продаж", "Edited in JSON");
    jsonInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector("#edit-preset-validation")?.textContent).toBe(
        "Edit the preset name using the name field."
      );
    });
  });

  it("formats valid JSON and confirms before resetting dirty JSON", async () => {
    await mountPopup([preset("one", "Sales review")]);
    click(editButton());

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const jsonInput = document.querySelector<HTMLTextAreaElement>("#edit-preset-json");
    if (!jsonInput) {
      throw new Error("Edit JSON input not found.");
    }

    jsonInput.value =
      '{"schemaVersion":1,"preset":{"id":"one","name":"Sales review","createdAt":"2026-06-09T10:00:00.000Z","updatedAt":"2026-06-09T10:00:00.000Z","filters":[{"title":"Region","type":"list","selectedLabels":["EMEA","APAC"]}]}}';
    jsonInput.dispatchEvent(new Event("input", { bubbles: true }));
    click(document.querySelector("#format-edit-preset-json") as Element);
    await vi.waitFor(() => {
      expect(jsonInput.value).toContain('\n  "schemaVersion": 1,');
    });

    jsonInput.value = jsonInput.value.replace('"EMEA"', '"West"');
    jsonInput.dispatchEvent(new Event("input", { bubbles: true }));
    click(document.querySelector("#reset-edit-preset-json") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#reset-edit-preset-dialog")?.hidden).toBe(false);
      expect(document.activeElement).toBe(document.querySelector("#cancel-reset-edit-preset"));
    });
    click(document.querySelector("#cancel-reset-edit-preset") as Element);
    expect(jsonInput.value).toContain('"West"');
    click(document.querySelector("#reset-edit-preset-json") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#reset-edit-preset-dialog")?.hidden).toBe(false);
    });
    click(document.querySelector("#confirm-reset-edit-preset") as Element);
    await vi.waitFor(() => {
      expect(JSON.parse(jsonInput.value)).toMatchObject({
        preset: {
          name: "Sales review",
          filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
        }
      });
    });
  });

  it("opens Save Review only after successful capture and prevents duplicate capture requests", async () => {
    let resolveCapture: ((response: { ok: true; filters: FilterPresetItem[] }) => void) | undefined;
    await mountPopup([]);
    testState.sendContentRequestToActiveTab.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        })
    );

    click(document.querySelector("#save-current") as Element);
    click(document.querySelector("#save-current") as Element);

    expect(document.querySelector("#result")?.textContent).toBe("Reading filters...");
    expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(true);
    expect(testState.sendContentRequestToActiveTab).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLButtonElement>("#rename-preset")?.disabled).toBe(true);
    expect(document.querySelector<HTMLSelectElement>("#preset-select")?.disabled).toBe(true);

    resolveCapture?.({ ok: true, filters: [filter("Region", ["EMEA"])] });
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(false);
    });
  });

  it("blocks other dialogs while capture is pending", async () => {
    let resolveCapture: ((response: { ok: true; filters: FilterPresetItem[] }) => void) | undefined;
    await mountPopup([preset("one", "One")]);
    testState.sendContentRequestToActiveTab.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        })
    );
    click(document.querySelector("#save-current") as Element);
    click(document.querySelector("#delete-preset") as Element);
    expect(document.querySelector<HTMLElement>(".delete-dialog")?.hidden).toBe(true);

    resolveCapture?.({ ok: true, filters: [filter("Region", ["EMEA"])] });
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(false);
    });
    expect(document.activeElement).toBe(document.querySelector("#save-name"));
  });

  it("keeps the main popup visible when capture fails", async () => {
    await mountPopup([]);
    testState.sendContentRequestToActiveTab.mockResolvedValueOnce({ ok: false, error: "Capture failed." });

    click(document.querySelector("#save-current") as Element);

    await vi.waitFor(() => {
      expect(document.querySelector("#result")?.textContent).toBe("Capture failed.");
    });
    expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".popup-content")?.hasAttribute("inert")).toBe(false);
  });

  it("shows only eligible filters in captured order with values collapsed and included", async () => {
    await mountPopup([]);
    await openSaveReview([
      filter("Region", ["EMEA", "APAC"]),
      filter("Empty", []),
      filter("Department", ["Produce", "Bakery"])
    ]);

    const rows = Array.from(document.querySelectorAll<HTMLElement>(".review-filter"));
    expect(rows.map((row) => row.querySelector(".review-filter-title")?.textContent)).toEqual([
      "Region",
      "Department"
    ]);
    expect(rows.map((row) => row.querySelector(".review-filter-count")?.textContent)).toEqual(["2", "2"]);
    expect(rows.map((row) => row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked)).toEqual([
      true,
      true
    ]);
    expect(rows.map((row) => row.querySelector<HTMLButtonElement>(".review-filter-disclosure")?.ariaExpanded)).toEqual([
      "false",
      "false"
    ]);
    expect(document.querySelector("#review-selection-count")?.textContent).toContain("2");
  });

  it("preserves value order and allows independent simultaneous expansion", async () => {
    await mountPopup([]);
    await openSaveReview([filter("Region", ["West", "East"]), filter("Team", ["Бета", "Альфа"])]);
    const disclosures = Array.from(document.querySelectorAll<HTMLButtonElement>(".review-filter-disclosure"));
    click(disclosures[0] as Element);
    click(disclosures[1] as Element);

    expect(disclosures.map((button) => button.ariaExpanded)).toEqual(["true", "true"]);
    expect(
      Array.from(document.querySelectorAll(".review-filter-values")).map((list) =>
        Array.from(list.querySelectorAll("li")).map((item) => item.textContent)
      )
    ).toEqual([
      ["West", "East"],
      ["Бета", "Альфа"]
    ]);

    const firstCheckbox = document.querySelector<HTMLInputElement>('.review-filter input[type="checkbox"]');
    if (!firstCheckbox) {
      throw new Error("Review checkbox not found.");
    }
    click(firstCheckbox);
    expect(firstCheckbox.checked).toBe(false);
    expect(disclosures[0]?.ariaExpanded).toBe("true");
  });

  it("supports Select all and Clear all and requires one included filter", async () => {
    await mountPopup([]);
    await openSaveReview([filter("Region", ["EMEA"]), filter("Team", ["North"])]);

    click(document.querySelector("#clear-all-filters") as Element);
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('.review-filter input[type="checkbox"]')).map(
        (checkbox) => checkbox.checked
      )
    ).toEqual([false, false]);
    expect(document.querySelector<HTMLButtonElement>("#confirm-save")?.disabled).toBe(true);
    expect(document.querySelector("#review-selection-guidance")?.textContent).toBe("Select at least one filter.");

    click(document.querySelector("#select-all-filters") as Element);
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('.review-filter input[type="checkbox"]')).map(
        (checkbox) => checkbox.checked
      )
    ).toEqual([true, true]);
    expect(document.querySelector<HTMLButtonElement>("#confirm-save")?.disabled).toBe(false);
  });

  it("shows the empty review state when capture contains no selected values", async () => {
    await mountPopup([]);
    await openSaveReview([filter("Region", []), filter("Team", [])]);

    expect(document.querySelector("#review-empty")?.textContent).toContain(
      "No selected filter values found. Select values in Power BI and try again."
    );
    expect(document.querySelectorAll(".review-filter")).toHaveLength(0);
    expect(document.querySelector<HTMLButtonElement>("#confirm-save")?.disabled).toBe(true);
  });

  it("validates required and duplicate save names without writing storage", async () => {
    await mountPopup([preset("one", "Sales Review")]);
    await openSaveReview([filter("Region", ["EMEA"])]);
    const nameInput = document.querySelector<HTMLInputElement>("#save-name");
    if (!nameInput) {
      throw new Error("Save name input not found.");
    }

    nameInput.value = "   ";
    click(document.querySelector("#confirm-save") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector("#save-name-error")?.textContent).toBe("Enter a preset name.");
    });

    nameInput.value = "  sales review  ";
    click(document.querySelector("#confirm-save") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector("#save-name-error")?.textContent).toBe(
        "A preset with this name already exists."
      );
    });
    expect(testState.savePreset).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(nameInput);
  });

  it("cancels Save Review without persisting and restores focus", async () => {
    await mountPopup([]);
    const trigger = document.querySelector<HTMLButtonElement>("#save-current");
    await openSaveReview([filter("Region", ["EMEA"])]);

    click(document.querySelector("#cancel-save") as Element);

    expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(true);
    expect(testState.savePreset).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("cancels Save Review on Escape and restores the Feature 1 popup width state", async () => {
    await mountPopup([]);
    const trigger = document.querySelector<HTMLButtonElement>("#save-current");
    await openSaveReview([filter("Region", ["EMEA"])]);
    expect(document.body.classList.contains("review-open")).toBe(true);

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(true);
    expect(document.body.classList.contains("review-open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("stores only included filters, selects the new preset, and returns to the main view", async () => {
    await mountPopup([preset("one", "Existing")]);
    await openSaveReview([
      filter("Region", ["EMEA", "APAC"]),
      filter("Empty", []),
      filter("Department", ["Produce"])
    ]);
    const checkboxes = document.querySelectorAll<HTMLInputElement>('.review-filter input[type="checkbox"]');
    click(checkboxes[1] as Element);
    const nameInput = document.querySelector<HTMLInputElement>("#save-name");
    if (!nameInput) {
      throw new Error("Save name input not found.");
    }
    nameInput.value = "  New preset  ";

    click(document.querySelector("#confirm-save") as Element);

    await vi.waitFor(() => {
      expect(testState.savePreset).toHaveBeenCalledWith(
        pageKey,
        expect.objectContaining({
          id: "00000000-0000-0000-0000-000000000000",
          name: "New preset",
          filters: [filter("Region", ["EMEA", "APAC"])]
        }),
        { uniqueNormalizedName: "new preset" }
      );
      expect(document.querySelector<HTMLSelectElement>("#preset-select")?.value).toBe(
        "00000000-0000-0000-0000-000000000000"
      );
      expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(true);
      expect(document.querySelector("#result")?.textContent).toBe("Saved 1 filters.");
    });
    expect(document.activeElement).toBe(document.querySelector("#apply-preset"));
  });

  it("preserves the Save Review draft after storage failure and allows retry", async () => {
    await mountPopup([]);
    await openSaveReview([filter("Region", ["EMEA"]), filter("Team", ["North"])]);
    const nameInput = document.querySelector<HTMLInputElement>("#save-name");
    const disclosures = document.querySelectorAll<HTMLButtonElement>(".review-filter-disclosure");
    const checkboxes = document.querySelectorAll<HTMLInputElement>('.review-filter input[type="checkbox"]');
    if (!nameInput) {
      throw new Error("Save name input not found.");
    }
    nameInput.value = "Retry preset";
    click(disclosures[0] as Element);
    click(checkboxes[1] as Element);
    testState.savePreset.mockRejectedValueOnce(new Error("Storage unavailable."));

    click(document.querySelector("#confirm-save") as Element);

    await vi.waitFor(() => {
      expect(document.querySelector("#save-storage-error")?.textContent).toBe("Storage unavailable.");
    });
    expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(false);
    expect(nameInput.value).toBe("Retry preset");
    expect(checkboxes[1]?.checked).toBe(false);
    expect(disclosures[0]?.ariaExpanded).toBe("true");

    click(document.querySelector("#confirm-save") as Element);
    await vi.waitFor(() => {
      expect(testState.savePreset).toHaveBeenCalledTimes(2);
      expect(document.querySelector<HTMLElement>("#save-review-dialog")?.hidden).toBe(true);
    });
  });

  it("uses required and current-report unique-name validation for Edit preset", async () => {
    await mountPopup([preset("one", "One"), preset("two", "Two")]);
    selectPreset("one");
    click(document.querySelector("#rename-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const nameInput = document.querySelector<HTMLInputElement>("#edit-preset-name");
    if (!nameInput) {
      throw new Error("Edit name input not found.");
    }

    nameInput.value = "   ";
    click(document.querySelector("#confirm-edit-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector("#edit-preset-name-error")?.textContent).toBe("Enter a preset name.");
    });

    nameInput.value = " two ";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    click(document.querySelector("#confirm-edit-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector("#edit-preset-name-error")?.textContent).toBe(
        "A preset with this name already exists."
      );
    });

    nameInput.value = " ONE ";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    click(document.querySelector("#confirm-edit-preset") as Element);
    await vi.waitFor(() => {
      expect(testState.savePreset).toHaveBeenCalledWith(
        pageKey,
        expect.objectContaining({ id: "one", name: "ONE" }),
        expect.objectContaining({ requireExisting: true, uniqueNormalizedName: "one" })
      );
      expect(document.querySelector<HTMLSelectElement>("#preset-select")?.value).toBe("one");
    });
  });

  it("preserves the Edit preset input after storage failure", async () => {
    await mountPopup([preset("one", "One")]);
    click(document.querySelector("#rename-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const nameInput = document.querySelector<HTMLInputElement>("#edit-preset-name");
    if (!nameInput) {
      throw new Error("Edit name input not found.");
    }
    nameInput.value = "Renamed after retry";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    testState.savePreset.mockRejectedValueOnce(new Error("Storage unavailable."));

    click(document.querySelector("#confirm-edit-preset") as Element);

    await vi.waitFor(() => {
      expect(document.querySelector("#edit-preset-save-error")?.textContent).toBe("Storage unavailable.");
    });
    expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    expect(nameInput.value).toBe("Renamed after retry");
    expect(document.querySelector<HTMLButtonElement>("#cancel-edit-preset")?.disabled).toBe(false);
  });

  it("blocks save when the preset changed elsewhere and keeps the draft", async () => {
    await mountPopup([preset("one", "One")]);
    click(document.querySelector("#rename-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const nameInput = document.querySelector<HTMLInputElement>("#edit-preset-name");
    const jsonInput = document.querySelector<HTMLTextAreaElement>("#edit-preset-json");
    if (!nameInput || !jsonInput) {
      throw new Error("Edit controls not found.");
    }
    nameInput.value = "Updated after stale";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    jsonInput.value = jsonInput.value.replace('"EMEA"', '"North"');
    jsonInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector("#edit-preset-validation")?.textContent).toBe("JSON is valid.");
    });
    testState.savePreset.mockRejectedValueOnce(
      new Error("This preset changed while you were editing it. Close the editor and reopen the preset before saving.")
    );

    click(document.querySelector("#confirm-edit-preset") as Element);

    await vi.waitFor(() => {
      expect(document.querySelector("#edit-preset-save-error")?.textContent).toContain("changed while you were editing");
    });
    expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    expect(nameInput.value).toBe("Updated after stale");
    expect(jsonInput.value).toContain('"North"');
  });

  it("blocks save when the preset was deleted elsewhere and keeps the draft", async () => {
    await mountPopup([preset("one", "One")]);
    click(document.querySelector("#rename-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const nameInput = document.querySelector<HTMLInputElement>("#edit-preset-name");
    if (!nameInput) {
      throw new Error("Edit name input not found.");
    }
    nameInput.value = "Updated after delete";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    testState.savePreset.mockRejectedValueOnce(new Error("The selected preset no longer exists."));

    click(document.querySelector("#confirm-edit-preset") as Element);

    await vi.waitFor(() => {
      expect(document.querySelector("#edit-preset-save-error")?.textContent).toBe(
        "The selected preset no longer exists."
      );
    });
    expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    expect(nameInput.value).toBe("Updated after delete");
  });

  it("ignores stale debounced validation callbacks after close and reopen", async () => {
    vi.useFakeTimers();
    await mountPopup([preset("one", "One")]);
    click(document.querySelector("#rename-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const jsonInput = document.querySelector<HTMLTextAreaElement>("#edit-preset-json");
    if (!jsonInput) {
      throw new Error("Edit JSON input not found.");
    }
    jsonInput.value = "{";
    jsonInput.dispatchEvent(new Event("input", { bubbles: true }));
    click(document.querySelector("#cancel-edit-preset") as Element);
    click(document.querySelector("#rename-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(document.querySelector("#edit-preset-validation")?.textContent).toBe("JSON is valid.");
    vi.useRealTimers();
  });

  it("applies only stored filters so omitted filters remain unchanged", async () => {
    const partialPreset = preset("one", "Partial");
    partialPreset.filters = [filter("Region", ["EMEA"])];
    await mountPopup([partialPreset]);
    testState.sendContentRequestToActiveTab.mockResolvedValueOnce({ ok: true, results: [] });

    click(document.querySelector("#apply-preset") as Element);

    await vi.waitFor(() => {
      expect(testState.sendContentRequestToActiveTab).toHaveBeenCalledWith({
        type: "APPLY_FILTERS",
        filters: [filter("Region", ["EMEA"])]
      });
    });
  });

  it("submits Save and Edit preset from the name field with Enter", async () => {
    await mountPopup([preset("one", "One")]);
    await openSaveReview([filter("Region", ["EMEA"])]);
    const saveName = document.querySelector<HTMLInputElement>("#save-name");
    if (!saveName) {
      throw new Error("Save name input not found.");
    }
    saveName.value = "Created with Enter";
    saveName.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(testState.savePreset).toHaveBeenCalledWith(
        pageKey,
        expect.objectContaining({ name: "Created with Enter" }),
        { uniqueNormalizedName: "created with enter" }
      );
    });

    selectPreset("one");
    click(document.querySelector("#rename-preset") as Element);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#edit-preset-dialog")?.hidden).toBe(false);
    });
    const renameName = document.querySelector<HTMLInputElement>("#edit-preset-name");
    if (!renameName) {
      throw new Error("Edit name input not found.");
    }
    renameName.value = "Renamed with Enter";
    renameName.dispatchEvent(new Event("input", { bubbles: true }));
    renameName.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => {
      expect(testState.savePreset).toHaveBeenCalledWith(
        pageKey,
        expect.objectContaining({ id: "one", name: "Renamed with Enter" }),
        expect.objectContaining({ requireExisting: true, uniqueNormalizedName: "renamed with enter" })
      );
    });
  });

  it("freezes editable Save Review controls while storage is pending and restores them after failure", async () => {
    let rejectSave: ((error: Error) => void) | undefined;
    await mountPopup([]);
    await openSaveReview([filter("Region", ["EMEA"])]);
    testState.savePreset.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        })
    );
    const nameInput = document.querySelector<HTMLInputElement>("#save-name");
    const checkbox = document.querySelector<HTMLInputElement>('.review-filter input[type="checkbox"]');
    if (!nameInput || !checkbox) {
      throw new Error("Save controls not found.");
    }

    click(document.querySelector("#confirm-save") as Element);
    await vi.waitFor(() => {
      expect(nameInput.disabled).toBe(true);
      expect(checkbox.disabled).toBe(true);
    });
    rejectSave?.(new Error("Storage unavailable."));
    await vi.waitFor(() => {
      expect(nameInput.disabled).toBe(false);
      expect(checkbox.disabled).toBe(false);
    });
  });

  it("shows an authoritative save name conflict as name validation and restores focus", async () => {
    await mountPopup([]);
    await openSaveReview([filter("Region", ["EMEA"])]);
    const conflict = new Error("A preset with this name already exists.");
    conflict.name = "PresetNameConflictError";
    testState.savePreset.mockRejectedValueOnce(conflict);

    click(document.querySelector("#confirm-save") as Element);

    await vi.waitFor(() => {
      expect(document.querySelector("#save-name-error")?.textContent).toBe(
        "A preset with this name already exists."
      );
      expect(document.activeElement).toBe(document.querySelector("#save-name"));
    });
    expect(document.querySelector("#save-storage-error")?.textContent).toBe("");
  });
});
