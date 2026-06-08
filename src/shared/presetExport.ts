import type { Preset } from "./types";

type PresetExport = {
  schemaVersion: 1;
  preset: Preset;
};

export function serializePresetExport(preset: Preset): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      preset
    },
    null,
    2
  );
}

export function parsePresetExport(input: unknown): Preset {
  let parsedInput = input;

  if (typeof parsedInput === "string") {
    try {
      parsedInput = JSON.parse(parsedInput) as unknown;
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

function isVersionedPresetExport(input: Record<string, unknown>): input is PresetExport {
  if (!("schemaVersion" in input) && !("preset" in input)) {
    return false;
  }

  if (input.schemaVersion !== 1) {
    throw new Error("Invalid preset export: schemaVersion must be 1.");
  }

  if (!isObject(input.preset)) {
    throw new Error("Invalid preset export: preset must be an object.");
  }

  return true;
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
