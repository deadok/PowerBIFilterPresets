import "./popup.css";
import popupMarkup from "./popup.html?raw";
import { getActiveTab, sendContentRequestToActiveTab } from "./contentMessaging";
import { serializePresetExport } from "../shared/presetExport";
import { createPresetStore, type PresetStore } from "../shared/presetStore";
import { summarizeResults } from "../shared/resultSummary";
import type { ContentRequest, ContentResponse, FilterPresetItem, PagePresetCollection, Preset } from "../shared/types";
import { normalizePageUrl } from "../shared/url";

type PopupDependencies = {
  store: PresetStore;
  getActiveTab: typeof getActiveTab;
  sendContentRequest: (request: ContentRequest) => Promise<ContentResponse>;
  prompt: (message: string, defaultValue?: string) => string | null;
  writeClipboard: (text: string) => Promise<void>;
  now: () => Date;
  randomUUID: () => string;
};

type PendingDeletion = {
  id: string;
  name: string;
  index: number;
  nextId?: string;
  previousId?: string;
};

const selectedActionIds = ["apply-preset", "export-preset", "rename-preset", "delete-preset"] as const;

function createPreset(filters: FilterPresetItem[], name: string, dependencies: PopupDependencies): Preset {
  const now = dependencies.now().toISOString();
  return {
    id: dependencies.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    filters
  };
}

function renderResult(element: HTMLOutputElement, text: string): void {
  element.value = text;
  element.textContent = text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Popup action failed.";
}

function runPopupAction(element: HTMLOutputElement, action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    renderResult(element, errorMessage(error));
  });
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Popup markup is missing ${selector}.`);
  }
  return element;
}

export async function mountPopup(app: HTMLDivElement, dependencies: PopupDependencies): Promise<void> {
  app.innerHTML = popupMarkup;

  const popupContent = requiredElement<HTMLDivElement>(app, ".popup-content");
  const pageStatus = requiredElement<HTMLParagraphElement>(app, "#page-status");
  const saveButton = requiredElement<HTMLButtonElement>(app, "#save-current");
  const applyButton = requiredElement<HTMLButtonElement>(app, "#apply-preset");
  const exportButton = requiredElement<HTMLButtonElement>(app, "#export-preset");
  const renameButton = requiredElement<HTMLButtonElement>(app, "#rename-preset");
  const deleteButton = requiredElement<HTMLButtonElement>(app, "#delete-preset");
  const presetSelect = requiredElement<HTMLSelectElement>(app, "#preset-select");
  const result = requiredElement<HTMLOutputElement>(app, "#result");
  const modalBackdrop = requiredElement<HTMLDivElement>(app, ".modal-backdrop");
  const deleteDialog = requiredElement<HTMLElement>(app, ".delete-dialog");
  const deletePresetName = requiredElement<HTMLElement>(app, "#delete-preset-name");
  const deleteError = requiredElement<HTMLParagraphElement>(app, "#delete-error");
  const cancelDeleteButton = requiredElement<HTMLButtonElement>(app, "#cancel-delete");
  const confirmDeleteButton = requiredElement<HTMLButtonElement>(app, "#confirm-delete");
  const iconButtons = Array.from(app.querySelectorAll<HTMLButtonElement>(".icon-button"));

  const tab = await dependencies.getActiveTab();
  const pageKey = normalizePageUrl(tab.url);
  let currentPresets: Preset[] = [];
  let pendingDeletion: PendingDeletion | undefined;
  let deleteInFlight = false;

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
    for (const id of selectedActionIds) {
      requiredElement<HTMLButtonElement>(app, `#${id}`).disabled = !hasSelection;
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

    pageStatus.textContent = `${currentPresets.length} presets for this URL`;
    presetSelect.disabled = currentPresets.length === 0;
    updateSelectedActionStates();
  }

  async function refreshPresets(preferredSelectionId?: string): Promise<void> {
    renderCollection(await dependencies.store.getPageCollection(pageKey), preferredSelectionId);
  }

  function closeDeleteDialog(restoreTriggerFocus: boolean): void {
    modalBackdrop.hidden = true;
    deleteDialog.hidden = true;
    popupContent.removeAttribute("inert");
    pendingDeletion = undefined;
    deleteError.hidden = true;
    deleteError.textContent = "";
    cancelDeleteButton.disabled = false;
    confirmDeleteButton.disabled = false;
    deleteInFlight = false;
    deleteDialog.removeAttribute("aria-busy");

    if (restoreTriggerFocus) {
      deleteButton.focus();
    }
  }

  function openDeleteDialog(): void {
    if (pendingDeletion) {
      return;
    }

    const preset = selectedPreset();
    const index = preset ? currentPresets.findIndex((candidate) => candidate.id === preset.id) : -1;
    if (!preset || index < 0) {
      renderResult(result, "Select a preset first.");
      updateSelectedActionStates();
      return;
    }

    pendingDeletion = {
      id: preset.id,
      name: preset.name,
      index,
      nextId: currentPresets[index + 1]?.id,
      previousId: currentPresets[index - 1]?.id
    };
    deletePresetName.textContent = `“${preset.name}”`;
    deleteError.hidden = true;
    deleteError.textContent = "";
    modalBackdrop.hidden = false;
    deleteDialog.hidden = false;
    popupContent.setAttribute("inert", "");
    cancelDeleteButton.focus();
  }

  function selectionAfterDeletion(collection: PagePresetCollection, deletion: PendingDeletion): string | undefined {
    const availableIds = new Set(collection.presets.map((preset) => preset.id));
    if (deletion.nextId && availableIds.has(deletion.nextId)) {
      return deletion.nextId;
    }
    if (deletion.previousId && availableIds.has(deletion.previousId)) {
      return deletion.previousId;
    }
    return collection.presets[Math.min(deletion.index, collection.presets.length - 1)]?.id;
  }

  saveButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      renderResult(result, "Reading filters...");
      const response = await dependencies.sendContentRequest({ type: "READ_FILTERS" });

      if (!response.ok || !("filters" in response)) {
        renderResult(result, response.ok ? "No filters returned." : response.error);
        return;
      }

      const name = dependencies.prompt("Preset name", `Preset ${dependencies.now().toLocaleString()}`);
      if (!name) {
        renderResult(result, "Save cancelled.");
        return;
      }

      const preset = createPreset(response.filters, name, dependencies);
      await dependencies.store.savePreset(pageKey, preset);
      await refreshPresets();
      renderResult(result, `Saved ${response.filters.length} filters.`);
    });
  });

  applyButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const preset = await storedSelectedPreset();
      if (!preset) {
        renderResult(result, "Select a preset first.");
        updateSelectedActionStates();
        return;
      }

      renderResult(result, "Applying preset...");
      const response = await dependencies.sendContentRequest({ type: "APPLY_FILTERS", filters: preset.filters });

      if (!response.ok || !("results" in response)) {
        renderResult(result, response.ok ? "No results returned." : response.error);
        return;
      }

      const details = response.results.map((item) => `${item.title}: ${item.message}`).join("\n");
      renderResult(result, `${summarizeResults(response.results)}\n${details}`);
    });
  });

  exportButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const preset = await storedSelectedPreset();
      if (!preset) {
        renderResult(result, "Select a preset first.");
        updateSelectedActionStates();
        return;
      }

      await dependencies.writeClipboard(serializePresetExport(preset));
      renderResult(result, "Preset JSON copied.");
    });
  });

  renameButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const preset = await storedSelectedPreset();
      if (!preset) {
        renderResult(result, "Select a preset first.");
        updateSelectedActionStates();
        return;
      }

      const name = dependencies.prompt("Preset name", preset.name);
      if (!name) {
        renderResult(result, "Rename cancelled.");
        return;
      }

      await dependencies.store.savePreset(pageKey, {
        ...preset,
        name,
        updatedAt: dependencies.now().toISOString()
      });
      await refreshPresets(preset.id);
      renderResult(result, "Preset renamed.");
    });
  });

  deleteButton.addEventListener("click", openDeleteDialog);
  cancelDeleteButton.addEventListener("click", () => {
    if (!deleteInFlight) {
      closeDeleteDialog(true);
    }
  });
  confirmDeleteButton.addEventListener("click", () => {
    if (!pendingDeletion || deleteInFlight) {
      return;
    }

    const deletion = pendingDeletion;
    deleteInFlight = true;
    cancelDeleteButton.disabled = true;
    confirmDeleteButton.disabled = true;
    deleteDialog.setAttribute("aria-busy", "true");
    deleteDialog.focus();
    deleteError.hidden = true;
    deleteError.textContent = "";

    void dependencies.store
      .deletePreset(pageKey, deletion.id)
      .then((collection) => {
        const preferredSelectionId = selectionAfterDeletion(collection, deletion);
        renderCollection(collection, preferredSelectionId);
        closeDeleteDialog(false);
        renderResult(result, "Preset deleted.");

        if (currentPresets.length > 0) {
          presetSelect.focus();
        } else {
          saveButton.focus();
        }
      })
      .catch((error: unknown) => {
        deleteInFlight = false;
        deleteDialog.removeAttribute("aria-busy");
        cancelDeleteButton.disabled = false;
        confirmDeleteButton.disabled = false;
        deleteError.textContent = errorMessage(error);
        deleteError.hidden = false;
        cancelDeleteButton.focus();
      });
  });

  presetSelect.addEventListener("change", updateSelectedActionStates);

  for (const button of iconButtons) {
    const revealTooltip = () => button.classList.remove("tooltip-suppressed");
    button.addEventListener("blur", revealTooltip);
    button.addEventListener("mouseleave", revealTooltip);
  }

  app.addEventListener("keydown", (event) => {
    if (modalBackdrop.hidden) {
      if (event.key === "Escape" && event.target instanceof HTMLButtonElement && event.target.matches(".icon-button")) {
        event.target.classList.add("tooltip-suppressed");
      }
      return;
    }

    if (event.key === "Escape") {
      if (deleteInFlight) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      closeDeleteDialog(true);
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableButtons = [cancelDeleteButton, confirmDeleteButton].filter((button) => !button.disabled);
    const first = focusableButtons[0];
    const last = focusableButtons.at(-1);
    if (!first || !last) {
      event.preventDefault();
      deleteDialog.focus();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!focusableButtons.includes(document.activeElement as HTMLButtonElement)) {
      event.preventDefault();
      first.focus();
    }
  });

  await refreshPresets();
}

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  const dependencies: PopupDependencies = {
    store: createPresetStore(),
    getActiveTab,
    sendContentRequest: sendContentRequestToActiveTab,
    prompt: (message, defaultValue) => window.prompt(message, defaultValue),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID()
  };

  mountPopup(app, dependencies).catch((error: unknown) => {
    app.textContent = errorMessage(error);
  });
}
