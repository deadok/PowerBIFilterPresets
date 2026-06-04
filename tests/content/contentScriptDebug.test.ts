import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDebugPreset, installDebugPresetHook } from "../../src/content/contentScript";
import { serializePresetExport } from "../../src/shared/presetExport";
import type { ContentResponse, FilterPresetItem, Preset } from "../../src/shared/types";

const filters: FilterPresetItem[] = [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }];

const samplePreset: Preset = {
  id: "preset_1",
  name: "Sales review",
  createdAt: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  filters
};

describe("applyDebugPreset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses an exported preset and applies its filters through the request handler", async () => {
    const response: ContentResponse = { ok: true, results: [] };
    const handleRequest = vi.fn().mockResolvedValue(response);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(applyDebugPreset(serializePresetExport(samplePreset), handleRequest)).resolves.toBe(response);

    expect(handleRequest).toHaveBeenCalledWith({ type: "APPLY_FILTERS", filters });
  });

  it("installs a CustomEvent debug hook for applying presets", async () => {
    const response: ContentResponse = { ok: true, results: [] };
    const handleRequest = vi.fn().mockResolvedValue(response);
    const target = new EventTarget() as Window;
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    installDebugPresetHook(target, handleRequest);
    target.dispatchEvent(new CustomEvent("PowerBIFilterPresets:applyPreset", { detail: samplePreset }));
    await vi.waitFor(() => expect(handleRequest).toHaveBeenCalledWith({ type: "APPLY_FILTERS", filters }));
  });

  it("dispatches an apply result event for page DevTools diagnostics", async () => {
    const response: ContentResponse = { ok: true, results: [] };
    const handleRequest = vi.fn().mockResolvedValue(response);
    const target = new EventTarget() as Window;
    const result = new Promise<CustomEvent<{ requestId: string; response: ContentResponse }>>((resolve) => {
      target.addEventListener("PowerBIFilterPresets:applyPresetResult", (event) => resolve(event as CustomEvent));
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    installDebugPresetHook(target, handleRequest);
    target.dispatchEvent(
      new CustomEvent("PowerBIFilterPresets:applyPreset", {
        detail: { requestId: "apply-1", presetExport: serializePresetExport(samplePreset) }
      })
    );

    await expect(result).resolves.toMatchObject({
      detail: {
        requestId: "apply-1",
        response
      }
    });
    expect(handleRequest).toHaveBeenCalledWith({ type: "APPLY_FILTERS", filters });
  });

  it("installs a debug hook for reading filters through the request handler", async () => {
    const response: ContentResponse = { ok: true, filters };
    const handleRequest = vi.fn().mockResolvedValue(response);
    const target = new EventTarget() as Window;

    installDebugPresetHook(target, handleRequest);

    const debugWindow = target as Window & {
      PowerBIFilterPresets: { readFilters: () => Promise<ContentResponse> };
    };

    await expect(debugWindow.PowerBIFilterPresets.readFilters()).resolves.toBe(response);
    expect(handleRequest).toHaveBeenCalledWith({ type: "READ_FILTERS" });
  });

  it("installs a CustomEvent debug hook for reading filters from page DevTools", async () => {
    const response: ContentResponse = { ok: true, filters };
    const handleRequest = vi.fn().mockResolvedValue(response);
    const target = new EventTarget() as Window;
    const result = new Promise<CustomEvent<{ requestId: string; response: ContentResponse }>>((resolve) => {
      target.addEventListener("PowerBIFilterPresets:readFiltersResult", (event) => resolve(event as CustomEvent));
    });

    installDebugPresetHook(target, handleRequest);
    target.dispatchEvent(new CustomEvent("PowerBIFilterPresets:readFilters", { detail: { requestId: "read-1" } }));

    await expect(result).resolves.toMatchObject({
      detail: {
        requestId: "read-1",
        response
      }
    });
    expect(handleRequest).toHaveBeenCalledWith({ type: "READ_FILTERS" });
  });
});
