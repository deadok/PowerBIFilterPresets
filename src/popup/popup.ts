import "./popup.css";
import popupMarkup from "./popup.html?raw";
import { createPresetStore } from "../shared/presetStore";
import { summarizeResults } from "../shared/resultSummary";
import type { ContentRequest, ContentResponse, FilterPresetItem, Preset } from "../shared/types";
import { normalizePageUrl } from "../shared/url";

const app = document.querySelector<HTMLDivElement>("#app");
const store = createPresetStore();

type ActiveTab = chrome.tabs.Tab & {
  id: number;
  url: string;
};

function createPreset(filters: FilterPresetItem[], name: string): Preset {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    filters
  };
}

async function getActiveTab(): Promise<ActiveTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("Active tab is not available.");
  }
  return tab as ActiveTab;
}

async function sendToActiveTab(request: ContentRequest): Promise<ContentResponse> {
  const tab = await getActiveTab();
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, request, (response: ContentResponse | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response) {
        reject(new Error("No response from content script."));
        return;
      }

      resolve(response);
    });
  });
}

function renderResult(element: HTMLOutputElement, text: string): void {
  element.value = text;
  element.textContent = text;
}

function runPopupAction(element: HTMLOutputElement, action: () => Promise<void>): void {
  void action().catch((error: unknown) => {
    renderResult(element, error instanceof Error ? error.message : "Popup action failed.");
  });
}

async function mount(): Promise<void> {
  if (!app) {
    return;
  }

  app.innerHTML = popupMarkup;

  const pageStatus = app.querySelector<HTMLParagraphElement>("#page-status");
  const saveButton = app.querySelector<HTMLButtonElement>("#save-current");
  const applyButton = app.querySelector<HTMLButtonElement>("#apply-preset");
  const renameButton = app.querySelector<HTMLButtonElement>("#rename-preset");
  const deleteButton = app.querySelector<HTMLButtonElement>("#delete-preset");
  const presetSelect = app.querySelector<HTMLSelectElement>("#preset-select");
  const result = app.querySelector<HTMLOutputElement>("#result");

  if (!pageStatus || !saveButton || !applyButton || !renameButton || !deleteButton || !presetSelect || !result) {
    app.textContent = "Popup markup is incomplete.";
    return;
  }

  const pageStatusElement = pageStatus;
  const applyButtonElement = applyButton;
  const renameButtonElement = renameButton;
  const deleteButtonElement = deleteButton;
  const presetSelectElement = presetSelect;
  const tab = await getActiveTab();
  const pageKey = normalizePageUrl(tab.url);

  async function refreshPresets(): Promise<void> {
    const collection = await store.getPageCollection(pageKey);
    presetSelectElement.innerHTML = "";

    for (const preset of collection.presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      presetSelectElement.append(option);
    }

    pageStatusElement.textContent = `${collection.presets.length} presets for this URL`;
    applyButtonElement.disabled = collection.presets.length === 0;
    renameButtonElement.disabled = collection.presets.length === 0;
    deleteButtonElement.disabled = collection.presets.length === 0;
  }

  saveButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      renderResult(result, "Reading filters...");
      const response = await sendToActiveTab({ type: "READ_FILTERS" });

      if (!response.ok || !("filters" in response)) {
        renderResult(result, response.ok ? "No filters returned." : response.error);
        return;
      }

      const name = window.prompt("Preset name", `Preset ${new Date().toLocaleString()}`);
      if (!name) {
        renderResult(result, "Save cancelled.");
        return;
      }

      const preset = createPreset(response.filters, name);
      await store.savePreset(pageKey, preset);
      await refreshPresets();
      renderResult(result, `Saved ${response.filters.length} filters.`);
    });
  });

  applyButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const collection = await store.getPageCollection(pageKey);
      const preset = collection.presets.find((candidate) => candidate.id === presetSelectElement.value);

      if (!preset) {
        renderResult(result, "Select a preset first.");
        return;
      }

      renderResult(result, "Applying preset...");
      const response = await sendToActiveTab({ type: "APPLY_FILTERS", filters: preset.filters });

      if (!response.ok || !("results" in response)) {
        renderResult(result, response.ok ? "No results returned." : response.error);
        return;
      }

      const details = response.results.map((item) => `${item.title}: ${item.message}`).join("\n");
      renderResult(result, `${summarizeResults(response.results)}\n${details}`);
    });
  });

  renameButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      const collection = await store.getPageCollection(pageKey);
      const preset = collection.presets.find((candidate) => candidate.id === presetSelectElement.value);
      if (!preset) {
        renderResult(result, "Select a preset first.");
        return;
      }

      const name = window.prompt("Preset name", preset.name);
      if (!name) {
        renderResult(result, "Rename cancelled.");
        return;
      }

      await store.savePreset(pageKey, { ...preset, name, updatedAt: new Date().toISOString() });
      await refreshPresets();
      renderResult(result, "Preset renamed.");
    });
  });

  deleteButton.addEventListener("click", () => {
    runPopupAction(result, async () => {
      if (!presetSelectElement.value) {
        renderResult(result, "Select a preset first.");
        return;
      }

      await store.deletePreset(pageKey, presetSelectElement.value);
      await refreshPresets();
      renderResult(result, "Preset deleted.");
    });
  });

  await refreshPresets();
}

mount().catch((error: unknown) => {
  if (app) {
    app.textContent = error instanceof Error ? error.message : "Popup failed to load.";
  }
});
