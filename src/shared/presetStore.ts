import type { FilterPresetItem, PagePresetCollection, Preset } from "./types";
import { isPresetRevisionMatch } from "./presetRevision";

type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type PresetStore = {
  getPageCollection(pageKey: string): Promise<PagePresetCollection>;
  savePreset(pageKey: string, preset: Preset, options?: SavePresetOptions): Promise<PagePresetCollection>;
  deletePreset(pageKey: string, presetId: string): Promise<PagePresetCollection>;
};

export type SavePresetOptions = {
  uniqueNormalizedName?: string;
  requireExisting?: boolean;
  expectedRevision?: string;
};

export class PresetNameConflictError extends Error {
  constructor() {
    super("A preset with this name already exists.");
    this.name = "PresetNameConflictError";
  }
}

export class PresetNotFoundError extends Error {
  constructor() {
    super("The selected preset no longer exists.");
    this.name = "PresetNotFoundError";
  }
}

export class PresetRevisionConflictError extends Error {
  constructor() {
    super("This preset changed while you were editing it. Close the editor and reopen the preset before saving.");
    this.name = "PresetRevisionConflictError";
  }
}

function storageKey(pageKey: string): string {
  return `page:${pageKey}`;
}

function emptyCollection(pageKey: string): PagePresetCollection {
  return {
    schemaVersion: 1,
    pageKey,
    presets: []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function decodeFilter(value: unknown): FilterPresetItem | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.title) || value.type !== "list") {
    return undefined;
  }
  if (!Array.isArray(value.selectedLabels) || !value.selectedLabels.every(isNonEmptyString)) {
    return undefined;
  }

  return {
    title: value.title,
    type: "list",
    selectedLabels: [...value.selectedLabels]
  };
}

function decodePreset(value: unknown): Preset | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt) ||
    !Array.isArray(value.filters)
  ) {
    return undefined;
  }

  const filters: FilterPresetItem[] = [];
  for (const filterValue of value.filters) {
    const filter = decodeFilter(filterValue);
    if (!filter) {
      return undefined;
    }
    filters.push(filter);
  }

  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    filters
  };
}

function decodePagePresetCollection(value: unknown, pageKey: string): PagePresetCollection | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.pageKey !== pageKey || !Array.isArray(value.presets)) {
    return undefined;
  }

  const presets: Preset[] = [];
  for (const presetValue of value.presets) {
    const preset = decodePreset(presetValue);
    if (!preset) {
      return undefined;
    }
    presets.push(preset);
  }

  return {
    schemaVersion: 1,
    pageKey,
    presets
  };
}

export function createPresetStore(storage: StorageArea = chrome.storage.local): PresetStore {
  let writeQueue = Promise.resolve();

  function serializeWrite<T>(write: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(write, write);
    writeQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  return {
    async getPageCollection(pageKey: string) {
      const key = storageKey(pageKey);
      const result = await storage.get(key);
      const value = result[key];
      const collection = decodePagePresetCollection(value, pageKey);

      if (collection) {
        return collection;
      }

      return emptyCollection(pageKey);
    },

    savePreset(pageKey: string, preset: Preset, options: SavePresetOptions = {}) {
      return serializeWrite(async () => {
        const collection = await this.getPageCollection(pageKey);
        const existingPreset = collection.presets.find((existing) => existing.id === preset.id);
        if (options.requireExisting && !existingPreset) {
          throw new PresetNotFoundError();
        }
        if (options.expectedRevision) {
          if (!existingPreset) {
            throw new PresetNotFoundError();
          }
          if (!isPresetRevisionMatch(existingPreset, options.expectedRevision)) {
            throw new PresetRevisionConflictError();
          }
        }
        if (
          options.uniqueNormalizedName &&
          collection.presets.some(
            (existing) =>
              existing.id !== preset.id && existing.name.trim().toLowerCase() === options.uniqueNormalizedName
          )
        ) {
          throw new PresetNameConflictError();
        }

        const presets = collection.presets.filter((existing) => existing.id !== preset.id);
        const nextCollection: PagePresetCollection = {
          ...collection,
          presets: [...presets, preset]
        };

        await storage.set({ [storageKey(pageKey)]: nextCollection });
        return nextCollection;
      });
    },

    deletePreset(pageKey: string, presetId: string) {
      return serializeWrite(async () => {
        const collection = await this.getPageCollection(pageKey);
        const nextCollection: PagePresetCollection = {
          ...collection,
          presets: collection.presets.filter((preset) => preset.id !== presetId)
        };

        await storage.set({ [storageKey(pageKey)]: nextCollection });
        return nextCollection;
      });
    }
  };
}
