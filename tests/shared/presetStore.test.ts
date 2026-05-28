import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPresetStore } from "../../src/shared/presetStore";
import type { PagePresetCollection, Preset } from "../../src/shared/types";

function createFakeStorage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    })
  };
}

const samplePreset: Preset = {
  id: "preset_1",
  name: "Sales review",
  createdAt: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
};

describe("createPresetStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T10:00:00.000Z"));
  });

  it("returns an empty collection for a new page", async () => {
    const storage = createFakeStorage();
    const store = createPresetStore(storage);

    await expect(store.getPageCollection("https://portal/reports/sales")).resolves.toEqual({
      schemaVersion: 1,
      pageKey: "https://portal/reports/sales",
      presets: []
    });
  });

  it("saves presets by page key", async () => {
    const storage = createFakeStorage();
    const store = createPresetStore(storage);

    await store.savePreset("https://portal/reports/sales", samplePreset);
    const collection = storage.data["page:https://portal/reports/sales"] as PagePresetCollection;

    expect(collection.presets).toHaveLength(1);
    expect(collection.presets[0]?.name).toBe("Sales review");
  });

  it("replaces a preset with the same id", async () => {
    const storage = createFakeStorage();
    const store = createPresetStore(storage);

    await store.savePreset("https://portal/reports/sales", samplePreset);
    await store.savePreset("https://portal/reports/sales", { ...samplePreset, name: "Updated" });

    const collection = await store.getPageCollection("https://portal/reports/sales");
    expect(collection.presets).toHaveLength(1);
    expect(collection.presets[0]?.name).toBe("Updated");
  });

  it("deletes presets by id", async () => {
    const storage = createFakeStorage();
    const store = createPresetStore(storage);

    await store.savePreset("https://portal/reports/sales", samplePreset);
    await store.deletePreset("https://portal/reports/sales", "preset_1");

    await expect(store.getPageCollection("https://portal/reports/sales")).resolves.toMatchObject({
      presets: []
    });
  });
});
