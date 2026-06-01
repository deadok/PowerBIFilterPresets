import { findBestFrameForFilters } from "./frameTarget";
import type { ContentRequest, ContentResponse } from "../shared/types";

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

export async function sendContentRequestToActiveTab(
  request: ContentRequest,
  dependencies: ContentMessagingDependencies = defaultDependencies()
): Promise<ContentResponse> {
  const tab = await dependencies.getActiveTab();
  const frameId = await dependencies.findBestFrameForFilters(tab.id);

  try {
    return await sendMessageToFrame(tab.id, frameId, request, dependencies);
  } catch (error) {
    if (!(error instanceof Error) || !isMissingReceiverError({ message: error.message })) {
      throw error;
    }

    await injectContentScript(tab.id, frameId, dependencies);
    return sendMessageToFrame(tab.id, frameId, request, dependencies);
  }
}
