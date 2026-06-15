import { describe, expect, it, vi } from "vitest";
import { sendContentRequestToActiveTab } from "../../src/popup/contentMessaging";
import type { ReadFiltersRequest, ReadFiltersResponse } from "../../src/shared/types";

const readFiltersRequest: ReadFiltersRequest = { type: "READ_FILTERS" };
const readFiltersResponse: ReadFiltersResponse = { ok: true, filters: [] };

describe("sendContentRequestToActiveTab", () => {
  it("injects the content script into the selected frame and retries when no receiver exists", async () => {
    const sendMessage = vi
      .fn()
      .mockImplementationOnce((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback();
      })
      .mockImplementationOnce((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback(readFiltersResponse);
      });
    const executeScript = vi.fn().mockResolvedValue([]);
    const lastErrors = [{ message: "Could not establish connection. Receiving end does not exist." }, undefined];

    await expect(
      sendContentRequestToActiveTab(readFiltersRequest, {
        getActiveTab: async () => ({ id: 42, url: "https://portal.example/report" }),
        findBestFrameForFilters: async () => 7,
        sendMessage,
        executeScript,
        getLastError: () => lastErrors.shift(),
        contentScriptFile: "assets/contentScript.js"
      })
    ).resolves.toEqual(readFiltersResponse);

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42, frameIds: [7] },
      files: ["assets/contentScript.js"]
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("uses main-world Power BI slicer state when DOM capture misses virtualized selections", async () => {
    const sendMessage = vi.fn().mockImplementation((_tabId, _request, _options, callback: (response?: unknown) => void) => {
      callback({ ok: true, filters: [{ title: "Продукт", type: "list", selectedLabels: [] }] });
    });
    const executeScript = vi.fn().mockResolvedValue([
      {
        frameId: 7,
        result: [{ title: "Продукт", type: "list", selectedLabels: ["Ядро персонализации", "Яндекс Трекер"] }]
      }
    ]);

    await expect(
      sendContentRequestToActiveTab(readFiltersRequest, {
        getActiveTab: async () => ({ id: 42, url: "https://portal.example/report" }),
        findBestFrameForFilters: async () => 7,
        sendMessage,
        executeScript,
        getLastError: () => undefined,
        contentScriptFile: "assets/contentScript.js"
      })
    ).resolves.toEqual({
      ok: true,
      filters: [
        { title: "Продукт", type: "list", selectedLabels: ["Ядро персонализации", "Яндекс Трекер"] }
      ]
    });

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 42, frameIds: [7] },
        world: "MAIN"
      })
    );
  });

  it("rejects a success response that does not match the request type", async () => {
    const sendMessage = vi.fn().mockImplementation((_tabId, _request, _options, callback: (response?: unknown) => void) => {
      callback({ ok: true, results: [] });
    });

    await expect(
      sendContentRequestToActiveTab(readFiltersRequest, {
        getActiveTab: async () => ({ id: 42, url: "https://portal.example/report" }),
        findBestFrameForFilters: async () => 7,
        sendMessage,
        executeScript: vi.fn().mockResolvedValue([]),
        getLastError: () => undefined,
        contentScriptFile: "assets/contentScript.js"
      })
    ).rejects.toThrow("Invalid response from content script.");
  });
});
