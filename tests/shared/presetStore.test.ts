import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PresetNameConflictError,
  PresetNotFoundError,
  PresetRevisionConflictError,
  createPresetStore
} from "../../src/shared/presetStore";
import { createPresetRevision } from "../../src/shared/presetRevision";
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

  it("serializes same-name creation and rejects the conflicting write", async () => {
    const storage = createFakeStorage();
    const store = createPresetStore(storage);
    const secondPreset = { ...samplePreset, id: "preset_2", name: " sales REVIEW " };

    const results = await Promise.allSettled([
      store.savePreset("https://portal/reports/sales", samplePreset, { uniqueNormalizedName: "sales review" }),
      store.savePreset("https://portal/reports/sales", secondPreset, { uniqueNormalizedName: "sales review" })
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(PresetNameConflictError) });
    await expect(store.getPageCollection("https://portal/reports/sales")).resolves.toMatchObject({
      presets: [expect.objectContaining({ name: "Sales review" })]
    });
  });

  it("does not recreate a preset when rename requires an existing id", async () => {
    const storage = createFakeStorage();
    const store = createPresetStore(storage);
    await store.savePreset("https://portal/reports/sales", samplePreset);
    await store.deletePreset("https://portal/reports/sales", samplePreset.id);

    await expect(
      store.savePreset(
        "https://portal/reports/sales",
        { ...samplePreset, name: "Renamed" },
        { requireExisting: true, uniqueNormalizedName: "renamed" }
      )
    ).rejects.toBeInstanceOf(PresetNotFoundError);
    await expect(store.getPageCollection("https://portal/reports/sales")).resolves.toMatchObject({ presets: [] });
  });

  it("rejects stale revision writes without changing the stored preset", async () => {
    const storage = createFakeStorage();
    const store = createPresetStore(storage);
    await store.savePreset("https://portal/reports/sales", samplePreset);
    const revision = createPresetRevision(samplePreset);
    const changedPreset = { ...samplePreset, name: "Changed elsewhere", updatedAt: "2026-05-28T10:05:00.000Z" };
    await store.savePreset("https://portal/reports/sales", changedPreset, { requireExisting: true });

    await expect(
      store.savePreset(
        "https://portal/reports/sales",
        { ...samplePreset, name: "Edited locally", updatedAt: "2026-05-28T10:10:00.000Z" },
        {
          requireExisting: true,
          expectedRevision: revision,
          uniqueNormalizedName: "edited locally"
        }
      )
    ).rejects.toBeInstanceOf(PresetRevisionConflictError);

    await expect(store.getPageCollection("https://portal/reports/sales")).resolves.toMatchObject({
      presets: [expect.objectContaining({ name: "Changed elsewhere" })]
    });
  });
});
