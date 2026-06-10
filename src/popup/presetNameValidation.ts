import type { PagePresetCollection } from "../shared/types";

export const REQUIRED_PRESET_NAME_ERROR = "Enter a preset name.";
export const DUPLICATE_PRESET_NAME_ERROR = "A preset with this name already exists.";

export type PresetNameValidationResult =
  | { valid: true; name: string }
  | { valid: false; error: string };

export function normalizePresetName(name: string): string {
  return name.trim().toLowerCase();
}

export function validatePresetName(
  name: string,
  collection: PagePresetCollection,
  excludedPresetId?: string
): PresetNameValidationResult {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { valid: false, error: REQUIRED_PRESET_NAME_ERROR };
  }

  const normalizedName = normalizePresetName(trimmedName);
  const duplicateExists = collection.presets.some(
    (preset) => preset.id !== excludedPresetId && normalizePresetName(preset.name) === normalizedName
  );

  if (duplicateExists) {
    return { valid: false, error: DUPLICATE_PRESET_NAME_ERROR };
  }

  return { valid: true, name: trimmedName };
}
