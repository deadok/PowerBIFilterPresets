import type { PagePresetCollection, Preset } from "./types";

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

function isPagePresetCollection(value: unknown, pageKey: string): value is PagePresetCollection {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as PagePresetCollection;
  return candidate.schemaVersion === 1 && candidate.pageKey === pageKey && Array.isArray(candidate.presets);
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

      if (isPagePresetCollection(value, pageKey)) {
        return value;
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
