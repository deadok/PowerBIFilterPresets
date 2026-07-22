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

const pageKey = "https://portal/reports/sales";
const storageKey = `page:${pageKey}`;

const samplePreset: Preset = {
  id: "preset_1",
  name: "Sales review",
  createdAt: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
};

function storedCollection(presets: unknown = [samplePreset]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    pageKey,
    presets
  };
}

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

  it.each([
    ["null root", null],
    ["primitive root", "invalid"],
    ["array root", []],
    ["array masquerading as a collection", Object.assign([], storedCollection())],
    ["invalid collection version", { ...storedCollection(), schemaVersion: 2 }],
    ["missing page key", { schemaVersion: 1, presets: [samplePreset] }],
    ["invalid page key", { ...storedCollection(), pageKey: 42 }],
    ["mismatched page key", { ...storedCollection(), pageKey: "https://portal/reports/other" }],
    ["non-array presets", storedCollection({ preset_1: samplePreset })]
  ])("returns an empty collection for %s", async (_description, storedValue) => {
    const storage = createFakeStorage();
    storage.data[storageKey] = storedValue;
    const store = createPresetStore(storage);

    await expect(store.getPageCollection(pageKey)).resolves.toEqual({
      schemaVersion: 1,
      pageKey,
      presets: []
    });
  });

  it.each([
    ["non-object preset", null],
    ["array masquerading as a preset", Object.assign([], samplePreset)],
    ["invalid preset id", { ...samplePreset, id: 7 }],
    ["empty preset id", { ...samplePreset, id: " " }],
    ["invalid preset name", { ...samplePreset, name: false }],
    ["empty preset name", { ...samplePreset, name: "" }],
    ["invalid created timestamp", { ...samplePreset, createdAt: null }],
    ["invalid updated timestamp", { ...samplePreset, updatedAt: 42 }],
    ["non-array filters", { ...samplePreset, filters: {} }]
  ])("returns an empty collection for %s", async (_description, invalidPreset) => {
    const storage = createFakeStorage();
    storage.data[storageKey] = storedCollection([invalidPreset]);
    const store = createPresetStore(storage);

    await expect(store.getPageCollection(pageKey)).resolves.toMatchObject({ presets: [] });
  });

  it.each([
    ["non-object filter", null],
    [
      "array masquerading as a filter",
      Object.assign([], { title: "Region", type: "list", selectedLabels: ["EMEA"] })
    ],
    ["invalid filter title", { title: 4, type: "list", selectedLabels: ["EMEA"] }],
    ["empty filter title", { title: " ", type: "list", selectedLabels: ["EMEA"] }],
    ["unsupported filter kind", { title: "Region", type: "range", selectedLabels: ["EMEA"] }],
    ["non-array selected labels", { title: "Region", type: "list", selectedLabels: "EMEA" }],
    ["non-string selected label", { title: "Region", type: "list", selectedLabels: ["EMEA", 4] }],
    ["empty selected label", { title: "Region", type: "list", selectedLabels: [""] }],
    ["invalid selection mode", { title: "Region", type: "list", selectedLabels: [], selectionMode: "some" }],
    ["contradictory selection mode", { title: "Region", type: "list", selectedLabels: ["EMEA"], selectionMode: "all" }]
  ])("returns an empty collection for %s", async (_description, invalidFilter) => {
    const storage = createFakeStorage();
    storage.data[storageKey] = storedCollection([{ ...samplePreset, filters: [invalidFilter] }]);
    const store = createPresetStore(storage);

    await expect(store.getPageCollection(pageKey)).resolves.toMatchObject({ presets: [] });
  });

  it("rejects the whole collection when valid and invalid presets are mixed", async () => {
    const storage = createFakeStorage();
    storage.data[storageKey] = storedCollection([samplePreset, { ...samplePreset, id: null }]);
    const store = createPresetStore(storage);

    await expect(store.getPageCollection(pageKey)).resolves.toMatchObject({ presets: [] });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("loads a valid current-version collection unchanged", async () => {
    const storage = createFakeStorage();
    const collection = storedCollection([
      samplePreset,
      {
        ...samplePreset,
        id: "preset_2",
        filters: [{ title: "Region", type: "list", selectedLabels: [] }]
      },
      {
        ...samplePreset,
        id: "preset_3",
        filters: []
      }
    ]);
    storage.data[storageKey] = collection;
    const store = createPresetStore(storage);

    await expect(store.getPageCollection(pageKey)).resolves.toEqual(collection);
  });

  it("loads and preserves all and none selection modes", async () => {
    const storage = createFakeStorage();
    const collection = storedCollection([
      {
        ...samplePreset,
        filters: [
          { title: "Region", type: "list", selectedLabels: [], selectionMode: "all" },
          { title: "Product", type: "list", selectedLabels: [], selectionMode: "none" }
        ]
      }
    ]);
    storage.data[storageKey] = collection;

    await expect(createPresetStore(storage).getPageCollection(pageKey)).resolves.toEqual(collection);
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
