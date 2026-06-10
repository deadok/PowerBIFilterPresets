import { createPresetExportDocument } from "./presetExport";
import type { Preset } from "./types";

export function createPresetRevision(preset: Preset): string {
  return JSON.stringify(createPresetExportDocument(preset));
}

export function isPresetRevisionMatch(preset: Preset, revision: string): boolean {
  return createPresetRevision(preset) === revision;
}
