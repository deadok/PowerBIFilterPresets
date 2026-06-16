import { describe, expect, it, vi } from "vitest";
import { sendContentRequestToActiveTab } from "../../src/popup/contentMessaging";
import type {
  ApplyFiltersRequest,
  ApplyFiltersResponse,
  ReadFiltersRequest,
  ReadFiltersResponse
} from "../../src/shared/types";

const readFiltersRequest: ReadFiltersRequest = { type: "READ_FILTERS" };
const readFiltersResponse: ReadFiltersResponse = { ok: true, filters: [] };
const applyFiltersRequest: ApplyFiltersRequest = {
  type: "APPLY_FILTERS",
  filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
};
const applyFiltersResponse: ApplyFiltersResponse = {
  ok: true,
  results: [{ title: "Region", status: "applied", message: "Applied 1 value." }]
};

function createDependencies(
  overrides: Partial<Parameters<typeof sendContentRequestToActiveTab>[1]> = {}
): NonNullable<Parameters<typeof sendContentRequestToActiveTab>[1]> {
  return {
    getActiveTab: async () => ({ id: 42, url: "https://portal.example/report" }),
    findBestFrameForFilters: async () => 7,
    sendMessage: vi.fn(),
    executeScript: vi.fn().mockResolvedValue([]),
    getLastError: () => undefined,
    contentScriptFile: "assets/contentScript.js",
    ...overrides
  };
}

describe("sendContentRequestToActiveTab", () => {
  it("resolves direct READ and APPLY success responses", async () => {
    const sendReadMessage = vi
      .fn()
      .mockImplementation((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback(readFiltersResponse);
      });
    await expect(
      sendContentRequestToActiveTab(readFiltersRequest, createDependencies({ sendMessage: sendReadMessage }))
    ).resolves.toEqual(readFiltersResponse);

    const sendApplyMessage = vi
      .fn()
      .mockImplementation((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback(applyFiltersResponse);
      });
    await expect(
      sendContentRequestToActiveTab(applyFiltersRequest, createDependencies({ sendMessage: sendApplyMessage }))
    ).resolves.toEqual(applyFiltersResponse);
  });

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

  it("uses the same READ enrichment path after missing receiver recovery", async () => {
    const sendMessage = vi
      .fn()
      .mockImplementationOnce((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback();
      })
      .mockImplementationOnce((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback({ ok: true, filters: [{ title: "Продукт", type: "list", selectedLabels: [] }] });
      });
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          frameId: 7,
          result: [{ title: "Продукт", type: "list", selectedLabels: ["Яндекс Трекер"] }]
        }
      ]);
    const lastErrors = [{ message: "Could not establish connection. Receiving end does not exist." }, undefined];

    await expect(
      sendContentRequestToActiveTab(
        readFiltersRequest,
        createDependencies({
          sendMessage,
          executeScript,
          getLastError: () => lastErrors.shift()
        })
      )
    ).resolves.toEqual({
      ok: true,
      filters: [{ title: "Продукт", type: "list", selectedLabels: ["Яндекс Трекер"] }]
    });

    expect(executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 42, frameIds: [7] },
      files: ["assets/contentScript.js"]
    });
    expect(executeScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        target: { tabId: 42, frameIds: [7] },
        world: "MAIN"
      })
    );
  });

  it("resolves retried APPLY success responses after missing receiver recovery", async () => {
    const sendMessage = vi
      .fn()
      .mockImplementationOnce((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback();
      })
      .mockImplementationOnce((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback(applyFiltersResponse);
      });
    const executeScript = vi.fn().mockResolvedValue([]);
    const lastErrors = [{ message: "Could not establish connection. Receiving end does not exist." }, undefined];

    await expect(
      sendContentRequestToActiveTab(
        applyFiltersRequest,
        createDependencies({
          sendMessage,
          executeScript,
          getLastError: () => lastErrors.shift()
        })
      )
    ).resolves.toEqual(applyFiltersResponse);

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42, frameIds: [7] },
      files: ["assets/contentScript.js"]
    });
  });

  it("rejects missing receiver recovery when the scripting API is unavailable", async () => {
    const sendMessage = vi
      .fn()
      .mockImplementation((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback();
      });

    await expect(
      sendContentRequestToActiveTab(
        readFiltersRequest,
        createDependencies({
          sendMessage,
          executeScript: undefined,
          getLastError: () => ({ message: "Could not establish connection. Receiving end does not exist." })
        })
      )
    ).rejects.toThrow("Content scripting API is not available.");
  });

  it("rejects injection failures during missing receiver recovery", async () => {
    const sendMessage = vi
      .fn()
      .mockImplementation((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback();
      });

    await expect(
      sendContentRequestToActiveTab(
        readFiltersRequest,
        createDependencies({
          sendMessage,
          executeScript: vi.fn().mockRejectedValue(new Error("Cannot access tab.")),
          getLastError: () => ({ message: "Could not establish connection. Receiving end does not exist." })
        })
      )
    ).rejects.toThrow("Cannot access tab.");
  });

  it("rejects retry failures after missing receiver recovery", async () => {
    const sendMessage = vi
      .fn()
      .mockImplementationOnce((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback();
      })
      .mockImplementationOnce((_tabId, _request, _options, callback: (response?: unknown) => void) => {
        callback();
      });
    const lastErrors = [
      { message: "Could not establish connection. Receiving end does not exist." },
      { message: "The message port closed before a response was received." }
    ];

    await expect(
      sendContentRequestToActiveTab(
        readFiltersRequest,
        createDependencies({
          sendMessage,
          getLastError: () => lastErrors.shift()
        })
      )
    ).rejects.toThrow("The message port closed before a response was received.");
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

  it("rejects malformed READ responses", async () => {
    const sendMessage = vi.fn().mockImplementation((_tabId, _request, _options, callback: (response?: unknown) => void) => {
      callback({ ok: true, filters: [{ title: "Region", type: "list", selectedLabels: [4] }] });
    });

    await expect(
      sendContentRequestToActiveTab(
        readFiltersRequest,
        createDependencies({
          sendMessage
        })
      )
    ).rejects.toThrow("Invalid response from content script.");
  });

  it("rejects malformed APPLY responses", async () => {
    const sendMessage = vi.fn().mockImplementation((_tabId, _request, _options, callback: (response?: unknown) => void) => {
      callback({ ok: true, results: [{ title: "Region", status: "unknown", message: "Invalid." }] });
    });

    await expect(
      sendContentRequestToActiveTab(
        applyFiltersRequest,
        createDependencies({
          sendMessage
        })
      )
    ).rejects.toThrow("Invalid response from content script.");
  });
});
