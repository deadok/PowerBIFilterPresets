import type { Preset } from "../shared/types";

const PRESET_EXPORT_SCHEMA_VERSION = 1;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVersionedPresetExport(input: Record<string, unknown>): boolean {
  if (!("schemaVersion" in input) && !("preset" in input)) {
    return false;
  }

  if (input.schemaVersion !== PRESET_EXPORT_SCHEMA_VERSION) {
    throw new Error("Invalid preset export: schemaVersion must be 1.");
  }

  if (!isObject(input.preset)) {
    throw new Error("Invalid preset export: preset must be an object.");
  }

  return true;
}

export function parsePresetExport(input: unknown): Preset {
  let parsedInput = input;

  if (typeof input === "string") {
    try {
      parsedInput = JSON.parse(input) as unknown;
    } catch {
      throw new Error("Invalid preset export JSON.");
    }
  }

  if (!isObject(parsedInput)) {
    throw new Error("Invalid preset export: expected an object.");
  }

  const preset = isVersionedPresetExport(parsedInput) ? parsedInput.preset : parsedInput;

  if (!isObject(preset)) {
    throw new Error("Invalid preset export: preset must be an object.");
  }

  if (!Array.isArray(preset.filters)) {
    throw new Error("Invalid preset export: preset.filters must be an array.");
  }

  return preset as Preset;
}
