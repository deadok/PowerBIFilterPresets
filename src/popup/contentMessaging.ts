import { findBestFrameForFilters } from "./frameTarget";
import type { ContentRequest, ContentResponse, FilterPresetItem } from "../shared/types";

export type ActiveTab = {
  id: number;
  url: string;
};

type SendMessage = (
  tabId: number,
  request: ContentRequest,
  optionsOrCallback: chrome.tabs.MessageSendOptions | ((response?: ContentResponse) => void),
  callback?: (response?: ContentResponse) => void
) => void;

type ContentMessagingDependencies = {
  getActiveTab: () => Promise<ActiveTab>;
  findBestFrameForFilters: (tabId: number) => Promise<number | undefined>;
  sendMessage: SendMessage;
  executeScript?: typeof chrome.scripting.executeScript;
  getLastError: () => chrome.runtime.LastError | undefined;
  contentScriptFile: string;
};

const CONTENT_SCRIPT_FILE = "assets/contentScript.js";

type PowerBiApiFilter = FilterPresetItem;

export async function getActiveTab(): Promise<ActiveTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("Active tab is not available.");
  }
  return tab as ActiveTab;
}

function defaultDependencies(): ContentMessagingDependencies {
  return {
    getActiveTab,
    findBestFrameForFilters,
    sendMessage: chrome.tabs.sendMessage.bind(chrome.tabs) as SendMessage,
    executeScript: chrome.scripting?.executeScript.bind(chrome.scripting),
    getLastError: () => chrome.runtime.lastError,
    contentScriptFile: CONTENT_SCRIPT_FILE
  };
}

function isMissingReceiverError(error: chrome.runtime.LastError | undefined): boolean {
  return error?.message?.includes("Receiving end does not exist") ?? false;
}

function sendMessageToFrame(
  tabId: number,
  frameId: number | undefined,
  request: ContentRequest,
  dependencies: ContentMessagingDependencies
): Promise<ContentResponse> {
  return new Promise((resolve, reject) => {
    const handleResponse = (response: ContentResponse | undefined): void => {
      const runtimeError = dependencies.getLastError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response) {
        reject(new Error("No response from content script."));
        return;
      }

      resolve(response);
    };

    if (frameId === undefined) {
      dependencies.sendMessage(tabId, request, handleResponse);
      return;
    }

    dependencies.sendMessage(tabId, request, { frameId }, handleResponse);
  });
}

async function injectContentScript(
  tabId: number,
  frameId: number | undefined,
  dependencies: ContentMessagingDependencies
): Promise<void> {
  if (!dependencies.executeScript) {
    return;
  }

  await dependencies.executeScript({
    target: frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] },
    files: [dependencies.contentScriptFile]
  });
}

function readPowerBiSlicerStatesInMainWorld(): PowerBiApiFilter[] | Promise<PowerBiApiFilter[]> {
  const toRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const normalizeLabel = (value: unknown): string => (typeof value === "string" ? value : String(value)).trim();
  const collectValues = (value: unknown, labels: string[]): void => {
    const record = toRecord(value);
    if (!record) {
      return;
    }

    if (Array.isArray(record.values)) {
      labels.push(...record.values.map(normalizeLabel).filter(Boolean));
    }

    for (const key of ["filters", "conditions"]) {
      const children = record[key];
      if (Array.isArray(children)) {
        children.forEach((child) => collectValues(child, labels));
      }
    }
  };
  const unique = (values: string[]): string[] => Array.from(new Set(values));
  const powerbi = toRecord((globalThis as unknown as Record<string, unknown>).powerbi);
  const embeds = Array.isArray(powerbi?.embeds) ? powerbi.embeds : [];

  return Promise.all(
    embeds
      .filter((embed) => typeof toRecord(embed)?.getPages === "function")
      .map(async (embed) => {
        const report = toRecord(embed);
        if (!report) {
          return [];
        }

        const pages = await (report.getPages as () => Promise<unknown[]>)().catch(() => []);
        const pageRecords = pages.map(toRecord).filter((page): page is Record<string, unknown> => page !== null);
        const activePage = pageRecords.find((page) => page.isActive === true) ?? pageRecords[0];
        if (!activePage || typeof activePage.getVisuals !== "function") {
          return [];
        }

        const visuals = await (activePage.getVisuals as () => Promise<unknown[]>)().catch(() => []);
        return Promise.all(
          visuals.map(async (visual) => {
            const visualRecord = toRecord(visual);
            if (
              !visualRecord ||
              visualRecord.type !== "slicer" ||
              typeof visualRecord.getSlicerState !== "function"
            ) {
              return null;
            }

            const title = normalizeLabel(visualRecord.title);
            if (!title) {
              return null;
            }

            const state = await (visualRecord.getSlicerState as () => Promise<unknown>)().catch(() => null);
            const selectedLabels: string[] = [];
            collectValues(state, selectedLabels);

            return { title, type: "list" as const, selectedLabels: unique(selectedLabels) };
          })
        );
      })
  ).then((groups) =>
    groups
      .flat()
      .filter((filter): filter is PowerBiApiFilter => filter !== null)
  );
}

async function readPowerBiSlicerStatesFromMainWorld(
  tabId: number,
  frameId: number | undefined,
  dependencies: ContentMessagingDependencies
): Promise<PowerBiApiFilter[]> {
  if (!dependencies.executeScript) {
    return [];
  }

  const results = await dependencies.executeScript({
    target: frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] },
    world: "MAIN",
    func: readPowerBiSlicerStatesInMainWorld
  });

  return results.flatMap((result) => result.result ?? []);
}

function mergeDomFiltersWithPowerBiApiState(
  domFilters: FilterPresetItem[],
  apiFilters: PowerBiApiFilter[]
): FilterPresetItem[] {
  const apiByTitle = new Map(apiFilters.map((filter) => [filter.title, filter]));

  return domFilters.map((filter) => {
    const apiFilter = apiByTitle.get(filter.title);
    if (!apiFilter || apiFilter.selectedLabels.length <= filter.selectedLabels.length) {
      return filter;
    }

    return { ...filter, selectedLabels: apiFilter.selectedLabels };
  });
}

export async function sendContentRequestToActiveTab(
  request: ContentRequest,
  dependencies: ContentMessagingDependencies = defaultDependencies()
): Promise<ContentResponse> {
  const tab = await dependencies.getActiveTab();
  const frameId = await dependencies.findBestFrameForFilters(tab.id);

  try {
    const response = await sendMessageToFrame(tab.id, frameId, request, dependencies);
    if (request.type === "READ_FILTERS" && response.ok && "filters" in response) {
      const apiFilters = await readPowerBiSlicerStatesFromMainWorld(tab.id, frameId, dependencies).catch(() => []);
      return { ok: true, filters: mergeDomFiltersWithPowerBiApiState(response.filters, apiFilters) };
    }

    return response;
  } catch (error) {
    if (!(error instanceof Error) || !isMissingReceiverError({ message: error.message })) {
      throw error;
    }

    await injectContentScript(tab.id, frameId, dependencies);
    const response = await sendMessageToFrame(tab.id, frameId, request, dependencies);
    if (request.type === "READ_FILTERS" && response.ok && "filters" in response) {
      const apiFilters = await readPowerBiSlicerStatesFromMainWorld(tab.id, frameId, dependencies).catch(() => []);
      return { ok: true, filters: mergeDomFiltersWithPowerBiApiState(response.filters, apiFilters) };
    }

    return response;
  }
}
