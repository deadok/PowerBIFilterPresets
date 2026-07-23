import { findBestFrameForFilters } from "./frameTarget";
import { decodeContentResponse } from "./contentResponseDecode";
import type {
  ApplyFiltersRequest,
  ApplyFiltersResponse,
  ContentRequest,
  ContentResponseFor,
  FilterPresetItem,
  ReadFiltersRequest,
  ReadFiltersResponse
} from "../shared/types";

export type ActiveTab = {
  id: number;
  url: string;
};

type SendMessage = <Request extends ContentRequest>(
  tabId: number,
  request: Request,
  optionsOrCallback: chrome.tabs.MessageSendOptions | ((response?: unknown) => void),
  callback?: (response?: unknown) => void
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
    sendMessage(tabId, request, optionsOrCallback, callback) {
      if (typeof optionsOrCallback === "function") {
        chrome.tabs.sendMessage(tabId, request, optionsOrCallback);
        return;
      }
      if (!callback) {
        throw new Error("Content message callback is required.");
      }
      chrome.tabs.sendMessage(tabId, request, optionsOrCallback, callback);
    },
    executeScript: chrome.scripting?.executeScript.bind(chrome.scripting),
    getLastError: () => chrome.runtime.lastError,
    contentScriptFile: CONTENT_SCRIPT_FILE
  };
}

function isMissingReceiverError(error: chrome.runtime.LastError | undefined): boolean {
  return error?.message?.includes("Receiving end does not exist") ?? false;
}

function sendMessageToFrame<Request extends ContentRequest>(
  tabId: number,
  frameId: number | undefined,
  request: Request,
  dependencies: ContentMessagingDependencies
): Promise<ContentResponseFor<Request>> {
  return new Promise((resolve, reject) => {
    const handleResponse = (response: unknown): void => {
      const runtimeError = dependencies.getLastError();
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (response === undefined) {
        reject(new Error("No response from content script."));
        return;
      }

      const decodedResponse = decodeContentResponse(request, response);
      if (!decodedResponse) {
        reject(new Error("Invalid response from content script."));
        return;
      }

      resolve(decodedResponse);
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
    throw new Error("Content scripting API is not available.");
  }

  await dependencies.executeScript({
    target: frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] },
    files: [dependencies.contentScriptFile]
  });
}

async function processContentResponse<Request extends ContentRequest>(
  tabId: number,
  frameId: number | undefined,
  request: Request,
  response: ContentResponseFor<Request>,
  dependencies: ContentMessagingDependencies
): Promise<ContentResponseFor<Request>> {
  if (request.type === "READ_FILTERS" && response.ok && "filters" in response) {
    const apiFilters = await readPowerBiSlicerStatesFromMainWorld(tabId, frameId, dependencies).catch(() => []);
    return {
      ok: true,
      filters: mergeDomFiltersWithPowerBiApiState(response.filters, apiFilters)
    } as ContentResponseFor<Request>;
  }

  return response;
}

async function sendAndProcessContentRequest<Request extends ContentRequest>(
  tabId: number,
  frameId: number | undefined,
  request: Request,
  dependencies: ContentMessagingDependencies
): Promise<ContentResponseFor<Request>> {
  const response = await sendMessageToFrame(tabId, frameId, request, dependencies);
  return processContentResponse(tabId, frameId, request, response, dependencies);
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
    if (filter.selectionMode || !apiFilter || apiFilter.selectedLabels.length < filter.selectedLabels.length) {
      return filter;
    }

    return { ...filter, selectedLabels: apiFilter.selectedLabels };
  });
}

export function sendContentRequestToActiveTab(
  request: ReadFiltersRequest,
  dependencies?: ContentMessagingDependencies
): Promise<ReadFiltersResponse>;
export function sendContentRequestToActiveTab(
  request: ApplyFiltersRequest,
  dependencies?: ContentMessagingDependencies
): Promise<ApplyFiltersResponse>;
export async function sendContentRequestToActiveTab<Request extends ContentRequest>(
  request: Request,
  dependencies: ContentMessagingDependencies = defaultDependencies()
): Promise<ContentResponseFor<Request>> {
  const tab = await dependencies.getActiveTab();
  const frameId = await dependencies.findBestFrameForFilters(tab.id);

  try {
    return await sendAndProcessContentRequest(tab.id, frameId, request, dependencies);
  } catch (error) {
    if (!(error instanceof Error) || !isMissingReceiverError({ message: error.message })) {
      throw error;
    }

    await injectContentScript(tab.id, frameId, dependencies);
    return sendAndProcessContentRequest(tab.id, frameId, request, dependencies);
  }
}
