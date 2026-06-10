import { PRESET_EXPORT_SCHEMA_VERSION, serializePresetExport } from "./presetExport";
import type { FilterPresetItem, Preset } from "./types";

type JsonObject = Record<string, unknown>;

export type EditPresetJsonError = {
  message: string;
  path?: string;
};

export type EditPresetJsonSuccess = {
  valid: true;
  filters: FilterPresetItem[];
  normalizedPreset: Preset;
  synchronizedText: string;
  formattedText: string;
};

export type EditPresetJsonFailure = {
  valid: false;
  error: EditPresetJsonError;
};

export type EditPresetJsonResult = EditPresetJsonSuccess | EditPresetJsonFailure;

export type ValidateEditPresetJsonOptions = {
  preset: Preset;
  authoritativeName: string;
  allowNameMismatch?: boolean;
};

export function createEditPresetDocument(preset: Preset): string {
  return serializePresetExport(preset);
}

export function resetEditPresetJson(preset: Preset, authoritativeName: string): string {
  return serializePresetExport({
    ...preset,
    name: authoritativeName
  });
}

export function formatEditPresetJson(text: string, options: ValidateEditPresetJsonOptions): string {
  const validation = validateEditPresetJson(text, options);
  if (!validation.valid) {
    throw new Error(validation.error.message);
  }

  return validation.formattedText;
}

export function validateEditPresetJson(text: string, options: ValidateEditPresetJsonOptions): EditPresetJsonResult {
  const parsedResult = parseJson(text);
  if (!parsedResult.valid) {
    return parsedResult;
  }

  const root = expectObject(parsedResult.value, undefined, "Preset JSON must be an object.");
  if (!root.valid) {
    return root;
  }

  const schemaVersion = root.value.schemaVersion;
  if (schemaVersion !== PRESET_EXPORT_SCHEMA_VERSION) {
    return invalid("schemaVersion: only version 1 is supported.", "schemaVersion");
  }

  const presetResult = expectObject(root.value.preset, "preset", "preset must be an object.");
  if (!presetResult.valid) {
    return presetResult;
  }

  const preset = presetResult.value;
  const originalPreset = options.preset;

  const id = expectString(preset.id, "preset.id");
  if (!id.valid) {
    return id;
  }
  if (id.value !== originalPreset.id) {
    return invalid("preset.id cannot be edited.", "preset.id");
  }

  const name = expectString(preset.name, "preset.name");
  if (!name.valid) {
    return name;
  }
  if (name.value !== options.authoritativeName && !options.allowNameMismatch) {
    return invalid("Edit the preset name using the name field.", "preset.name");
  }

  const createdAt = expectString(preset.createdAt, "preset.createdAt");
  if (!createdAt.valid) {
    return createdAt;
  }
  if (createdAt.value !== originalPreset.createdAt) {
    return invalid("preset.createdAt cannot be edited.", "preset.createdAt");
  }

  const updatedAt = expectString(preset.updatedAt, "preset.updatedAt");
  if (!updatedAt.valid) {
    return updatedAt;
  }
  if (updatedAt.value !== originalPreset.updatedAt) {
    return invalid("preset.updatedAt cannot be edited.", "preset.updatedAt");
  }

  if (!Array.isArray(preset.filters)) {
    return invalid("preset.filters must be an array.", "preset.filters");
  }
  if (preset.filters.length === 0) {
    return invalid("preset.filters: Add at least one filter.", "preset.filters");
  }

  const filters: FilterPresetItem[] = [];
  const seenTitles = new Map<string, number>();

  for (const [filterIndex, value] of preset.filters.entries()) {
    const filterPath = `preset.filters[${filterIndex}]`;
    const filter = expectObject(value, filterPath, `${filterPath} must be an object.`);
    if (!filter.valid) {
      return filter;
    }

    const title = expectString(filter.value.title, `${filterPath}.title`);
    if (!title.valid) {
      return title;
    }
    if (normalizeComparable(title.value).length === 0) {
      return invalid(`${filterPath}.title: Enter a filter title.`, `${filterPath}.title`);
    }

    const type = expectString(filter.value.type, `${filterPath}.type`);
    if (!type.valid) {
      return type;
    }
    if (type.value !== "list") {
      return invalid(`${filterPath}.type: only "list" is supported.`, `${filterPath}.type`);
    }

    if (!Array.isArray(filter.value.selectedLabels)) {
      return invalid(`${filterPath}.selectedLabels must be an array.`, `${filterPath}.selectedLabels`);
    }
    if (filter.value.selectedLabels.length === 0) {
      return invalid(`${filterPath}.selectedLabels: Add at least one selected label.`, `${filterPath}.selectedLabels`);
    }

    const selectedLabels: string[] = [];
    const seenLabels = new Set<string>();
    for (const [labelIndex, labelValue] of filter.value.selectedLabels.entries()) {
      const labelPath = `${filterPath}.selectedLabels[${labelIndex}]`;
      const label = expectString(labelValue, labelPath);
      if (!label.valid) {
        return label;
      }

      const normalizedLabel = normalizeComparable(label.value);
      if (normalizedLabel.length === 0) {
        return invalid(`${labelPath}: Enter a selected label.`, labelPath);
      }
      if (seenLabels.has(normalizedLabel)) {
        return invalid(`${labelPath}: Duplicate selected label.`, labelPath);
      }

      seenLabels.add(normalizedLabel);
      selectedLabels.push(label.value);
    }

    const normalizedTitle = normalizeComparable(title.value);
    if (seenTitles.has(normalizedTitle)) {
      return invalid(`${filterPath}.title: Duplicate filter title.`, `${filterPath}.title`);
    }
    seenTitles.set(normalizedTitle, filterIndex);

    filters.push({
      title: title.value,
      type: "list",
      selectedLabels
    });
  }

  const normalizedPreset: Preset = {
    id: originalPreset.id,
    name: options.authoritativeName,
    createdAt: originalPreset.createdAt,
    updatedAt: originalPreset.updatedAt,
    filters
  };

  const formattedText = serializePresetExport(normalizedPreset);
  return {
    valid: true,
    filters,
    normalizedPreset,
    synchronizedText: formattedText,
    formattedText
  };
}

function parseJson(text: string): { valid: true; value: unknown } | EditPresetJsonFailure {
  try {
    return {
      valid: true,
      value: JSON.parse(text) as unknown
    };
  } catch (error) {
    return invalid(syntaxErrorMessage(error, text));
  }
}

function expectObject(
  value: unknown,
  path: string | undefined,
  message: string
): { valid: true; value: JsonObject } | EditPresetJsonFailure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(message, path);
  }

  return {
    valid: true as const,
    value: value as JsonObject
  };
}

function expectString(value: unknown, path: string) {
  if (typeof value !== "string") {
    return invalid(`${path} must be a string.`, path);
  }

  return {
    valid: true as const,
    value
  };
}

function normalizeComparable(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function invalid(message: string, path?: string): EditPresetJsonFailure {
  return {
    valid: false,
    error: {
      message,
      path
    }
  };
}

function syntaxErrorMessage(error: unknown, text: string): string {
  const message = error instanceof Error ? error.message : "Invalid JSON.";
  const directMatch = message.match(/line (\d+) column (\d+)/i);
  if (directMatch) {
    return `Invalid JSON at line ${directMatch[1]} column ${directMatch[2]}.`;
  }

  const positionMatch = message.match(/position (\d+)/i);
  if (positionMatch) {
    const position = Number(positionMatch[1]);
    const prefix = text.slice(0, Number.isNaN(position) ? text.length : position);
    const lines = prefix.split("\n");
    const line = lines.length;
    const column = lines.at(-1)?.length ?? 0;
    return `Invalid JSON at line ${line} column ${column + 1}.`;
  }

  return "Invalid JSON.";
}
