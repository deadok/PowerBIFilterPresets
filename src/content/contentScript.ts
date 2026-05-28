import { createPowerBiDomAdapter } from "./powerBiDomAdapter";
import type { ContentRequest, ContentResponse, FilterOperationResult } from "../shared/types";

const adapter = createPowerBiDomAdapter(document);

async function handleRequest(request: ContentRequest): Promise<ContentResponse> {
  const ready = await adapter.waitForFilterControls();
  if (!ready) {
    return { ok: false, error: "Power BI list filters did not appear before timeout." };
  }

  if (request.type === "READ_FILTERS") {
    return { ok: true, filters: adapter.readListFilters() };
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

chrome.runtime.onMessage.addListener((request: ContentRequest, _sender, sendResponse) => {
  handleRequest(request)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown content script error." });
    });

  return true;
});
