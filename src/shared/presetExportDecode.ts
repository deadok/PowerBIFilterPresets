import type { FilterPresetItem, Preset } from "./types";

const PRESET_EXPORT_SCHEMA_VERSION = 1;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid preset export: ${path} must be a string.`);
  }
  return value;
}

function decodeFilters(value: unknown): FilterPresetItem[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid preset export: preset.filters must be an array.");
  }

  return value.map((filterValue, filterIndex) => {
    const filterPath = `preset.filters[${filterIndex}]`;
    if (!isObject(filterValue)) {
      throw new Error(`Invalid preset export: ${filterPath} must be an object.`);
    }

    const title = requireString(filterValue.title, `${filterPath}.title`);
    if (filterValue.type !== "list") {
      throw new Error(`Invalid preset export: ${filterPath}.type must be "list".`);
    }
    if (!Array.isArray(filterValue.selectedLabels)) {
      throw new Error(`Invalid preset export: ${filterPath}.selectedLabels must be an array.`);
    }

    const selectedLabels = filterValue.selectedLabels.map((labelValue, labelIndex) =>
      requireString(labelValue, `${filterPath}.selectedLabels[${labelIndex}]`)
    );

    return {
      title,
      type: "list" as const,
      selectedLabels
    };
  });
}

function decodePreset(value: unknown): Preset {
  if (!isObject(value)) {
    throw new Error("Invalid preset export: preset must be an object.");
  }

  return {
    id: requireString(value.id, "preset.id"),
    name: requireString(value.name, "preset.name"),
    createdAt: requireString(value.createdAt, "preset.createdAt"),
    updatedAt: requireString(value.updatedAt, "preset.updatedAt"),
    filters: decodeFilters(value.filters)
  };
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

  if (Object.hasOwn(parsedInput, "schemaVersion") || Object.hasOwn(parsedInput, "preset")) {
    if (parsedInput.schemaVersion !== PRESET_EXPORT_SCHEMA_VERSION) {
      throw new Error("Invalid preset export: schemaVersion must be 1.");
    }
    return decodePreset(parsedInput.preset);
  }

  return decodePreset(parsedInput);
}
