import type { Preset } from "./types";

export const PRESET_EXPORT_SCHEMA_VERSION = 1;

type PresetExport = {
  schemaVersion: typeof PRESET_EXPORT_SCHEMA_VERSION;
  preset: Preset;
};

export function createPresetExportDocument(preset: Preset): PresetExport {
  return {
    schemaVersion: PRESET_EXPORT_SCHEMA_VERSION,
    preset
  };
}

export function serializePresetExport(preset: Preset): string {
  return JSON.stringify(createPresetExportDocument(preset), null, 2);
}
