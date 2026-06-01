import { createPowerBiDomAdapter } from "./powerBiDomAdapter";
import { parsePresetExport } from "../shared/presetExport";
import type { ContentRequest, ContentResponse, FilterOperationResult } from "../shared/types";

const LOG_PREFIX = "[Power BI Presets]";

const adapter = createPowerBiDomAdapter(document);

async function handleRequest(request: ContentRequest): Promise<ContentResponse> {
  const ready = await adapter.waitForFilterControls();
  if (!ready) {
    return { ok: false, error: "Power BI list filters did not appear before timeout." };
  }

  if (request.type === "READ_FILTERS") {
    return { ok: true, filters: await adapter.readListFilters() };
  }

  if (request.type === "APPLY_FILTERS") {
    const results: FilterOperationResult[] = [];

    for (const filter of request.filters) {
      results.push(await adapter.applyListFilterSelection(filter.title, filter.selectedLabels));
    }

    return { ok: true, results };
  }

  return { ok: false, error: "Unsupported request." };
}

export async function applyDebugPreset(
  detail: unknown,
  requestHandler: (request: ContentRequest) => Promise<ContentResponse> = handleRequest
): Promise<ContentResponse> {
  const preset = parsePresetExport(detail);
  const response = await requestHandler({ type: "APPLY_FILTERS", filters: preset.filters });
  console.info(LOG_PREFIX, "Debug preset apply result:", response);
  return response;
}

export function installDebugPresetHook(
  targetWindow: Window,
  requestHandler: (request: ContentRequest) => Promise<ContentResponse> = handleRequest
): void {
  targetWindow.addEventListener("PowerBIFilterPresets:applyPreset", (event) => {
    void applyDebugPreset((event as CustomEvent<unknown>).detail, requestHandler).catch((error: unknown) => {
      console.error(LOG_PREFIX, "Debug preset apply failed:", error instanceof Error ? error.message : error);
    });
  });

  Object.assign(targetWindow, {
    PowerBIFilterPresets: {
      applyPreset: (detail: unknown) => applyDebugPreset(detail, requestHandler)
    }
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((request: ContentRequest, _sender, sendResponse) => {
    handleRequest(request)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown content script error." });
      });

    return true;
  });
}

if (typeof window !== "undefined") {
  installDebugPresetHook(window);
}
