import { createPowerBiDomAdapter } from "./powerBiDomAdapter";
import { parsePresetExport } from "./presetExportParse";
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
    const detail = (event as CustomEvent<{ presetExport?: unknown; requestId?: string }>).detail;
    const requestId = detail?.requestId;
    const presetExport = detail?.presetExport ?? detail;

    void applyDebugPreset(presetExport, requestHandler)
      .then((response) => {
        if (requestId) {
          targetWindow.dispatchEvent(
            new CustomEvent("PowerBIFilterPresets:applyPresetResult", { detail: { requestId, response } })
          );
        }
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : "Unknown apply preset error.";
        console.error(LOG_PREFIX, "Debug preset apply failed:", errorMessage);
        if (requestId) {
          targetWindow.dispatchEvent(
            new CustomEvent("PowerBIFilterPresets:applyPresetResult", { detail: { requestId, error: errorMessage } })
          );
        }
      });
  });

  targetWindow.addEventListener("PowerBIFilterPresets:readFilters", (event) => {
    const requestId = (event as CustomEvent<{ requestId?: string }>).detail?.requestId;
    void requestHandler({ type: "READ_FILTERS" })
      .then((response) => {
        targetWindow.dispatchEvent(
          new CustomEvent("PowerBIFilterPresets:readFiltersResult", { detail: { requestId, response } })
        );
      })
      .catch((error: unknown) => {
        targetWindow.dispatchEvent(
          new CustomEvent("PowerBIFilterPresets:readFiltersResult", {
            detail: { requestId, error: error instanceof Error ? error.message : "Unknown read filters error." }
          })
        );
      });
  });

  Object.assign(targetWindow, {
    PowerBIFilterPresets: {
      applyPreset: (detail: unknown) => applyDebugPreset(detail, requestHandler),
      readFilters: () => requestHandler({ type: "READ_FILTERS" })
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
