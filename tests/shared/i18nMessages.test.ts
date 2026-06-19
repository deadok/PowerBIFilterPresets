import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMessage,
  installTestMessages,
  resetTestMessages,
  type MessageKey
} from "../../src/shared/i18n/messages";

describe("i18n messages", () => {
  afterEach(() => {
    resetTestMessages();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("resolves typed message keys through the installed test catalog", () => {
    installTestMessages({
      pageStatusWithPresetCountPlural: "$1 presets for this URL",
      popupLoadingCurrentPage: "Loading current page..."
    });

    expect(getMessage("popupLoadingCurrentPage")).toBe("Loading current page...");
    expect(getMessage("pageStatusWithPresetCountPlural", ["3"])).toBe("3 presets for this URL");
  });

  it("treats the installed test catalog as authoritative for missing-key failures", () => {
    installTestMessages({
      popupLoadingCurrentPage: "Loading current page..."
    });

    expect(() => getMessage("pageStatusWithPresetCountPlural")).toThrow(/pageStatusWithPresetCountPlural/);
  });

  it("allows only declared message keys at compile time", () => {
    const key: MessageKey = "popupLoadingCurrentPage";

    expect(key).toBe("popupLoadingCurrentPage");
  });

  it("delegates to chrome.i18n when the runtime API exists", () => {
    const getMessageMock = vi.fn().mockReturnValue("Power BI Presets");
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { i18n: { getMessage: getMessageMock } }
    });

    expect(getMessage("actionDefaultTitle")).toBe("Power BI Presets");
    expect(getMessageMock).toHaveBeenCalledWith("actionDefaultTitle", undefined);
  });

  it("throws instead of falling back when chrome.i18n returns an empty string", () => {
    const getMessageMock = vi.fn().mockReturnValue("");
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: { i18n: { getMessage: getMessageMock } }
    });
    installTestMessages({
      actionDefaultTitle: "Power BI Presets"
    });

    expect(() => getMessage("actionDefaultTitle")).toThrow(/actionDefaultTitle/);
    expect(getMessageMock).toHaveBeenCalledWith("actionDefaultTitle", undefined);
  });
});
