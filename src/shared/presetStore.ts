import type { PagePresetCollection, Preset } from "./types";

type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type PresetStore = {
  getPageCollection(pageKey: string): Promise<PagePresetCollection>;
  savePreset(pageKey: string, preset: Preset): Promise<PagePresetCollection>;
  deletePreset(pageKey: string, presetId: string): Promise<PagePresetCollection>;
};

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

    async savePreset(pageKey: string, preset: Preset) {
      const collection = await this.getPageCollection(pageKey);
      const presets = collection.presets.filter((existing) => existing.id !== preset.id);
      const nextCollection: PagePresetCollection = {
        ...collection,
        presets: [...presets, preset]
      };

      await storage.set({ [storageKey(pageKey)]: nextCollection });
      return nextCollection;
    },

    async deletePreset(pageKey: string, presetId: string) {
      const collection = await this.getPageCollection(pageKey);
      const nextCollection: PagePresetCollection = {
        ...collection,
        presets: collection.presets.filter((preset) => preset.id !== presetId)
      };

      await storage.set({ [storageKey(pageKey)]: nextCollection });
      return nextCollection;
    }
  };
}
