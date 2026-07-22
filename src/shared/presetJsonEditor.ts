import { PRESET_EXPORT_SCHEMA_VERSION, serializePresetExport } from "./presetExport";
import type { FilterPresetItem, Preset } from "./types";

type JsonObject = Record<string, unknown>;

type PresetJsonError = {
  message: string;
  path?: string;
};

type PresetJsonSuccess = {
  valid: true;
  filters: FilterPresetItem[];
  normalizedPreset: Preset;
  synchronizedText: string;
  formattedText: string;
};

type PresetJsonFailure = {
  valid: false;
  error: PresetJsonError;
};

type ControlledPresetJsonOptions = {
  controlledPreset: Preset;
  authoritativeName: string;
  allowNameMismatch?: boolean;
};

export type EditPresetJsonError = PresetJsonError;
export type EditPresetJsonSuccess = PresetJsonSuccess;
export type EditPresetJsonFailure = PresetJsonFailure;
export type EditPresetJsonResult = PresetJsonSuccess | PresetJsonFailure;

export type CreatePresetJsonSuccess = PresetJsonSuccess;
export type CreatePresetJsonFailure = PresetJsonFailure;
export type CreatePresetJsonResult = PresetJsonSuccess | PresetJsonFailure;

export type ValidateEditPresetJsonOptions = {
  preset: Preset;
  authoritativeName: string;
  allowNameMismatch?: boolean;
};

export type ValidateCreatePresetJsonOptions = {
  provisionalPreset: Preset;
  authoritativeName: string;
  allowNameMismatch?: boolean;
};

export type CreatePresetDocumentOptions = Pick<Preset, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<Preset, "name" | "filters">>;

export type SanitizedImportedPresetDocument =
  | {
      valid: true;
      text: string;
      adoptedName: string;
    }
  | PresetJsonFailure;

export function createEditPresetDocument(preset: Preset): string {
  return serializePresetExport(preset);
}

export function createCreatePresetDocument(options: CreatePresetDocumentOptions): string {
  return serializePresetExport({
    id: options.id,
    name: options.name ?? "",
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    filters: options.filters ?? []
  });
}

export function resetEditPresetJson(preset: Preset, authoritativeName: string): string {
  return serializePresetExport({
    ...preset,
    name: authoritativeName
  });
}

export function resetCreatePresetJson(provisionalPreset: Preset, authoritativeName: string): string {
  return serializePresetExport({
    ...provisionalPreset,
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

export function formatCreatePresetJson(text: string, options: ValidateCreatePresetJsonOptions): string {
  const validation = validateCreatePresetJson(text, options);
  if (!validation.valid) {
    throw new Error(validation.error.message);
  }

  return validation.formattedText;
}

export function validateEditPresetJson(text: string, options: ValidateEditPresetJsonOptions): EditPresetJsonResult {
  return validateControlledPresetJson(text, {
    controlledPreset: options.preset,
    authoritativeName: options.authoritativeName,
    allowNameMismatch: options.allowNameMismatch
  });
}

export function validateCreatePresetJson(text: string, options: ValidateCreatePresetJsonOptions): CreatePresetJsonResult {
  return validateControlledPresetJson(text, {
    controlledPreset: options.provisionalPreset,
    authoritativeName: options.authoritativeName,
    allowNameMismatch: options.allowNameMismatch
  });
}

export function sanitizeImportedPresetDocument(
  text: string,
  options: { provisionalPreset: Preset }
): SanitizedImportedPresetDocument {
  const parsedResult = parseJson(text);
  if (!parsedResult.valid) {
    return parsedResult;
  }

  const root = expectObject(parsedResult.value, undefined, "Preset JSON must be an object.");
  if (!root.valid) {
    return root;
  }

  if (!Object.hasOwn(root.value, "schemaVersion") || !Object.hasOwn(root.value, "preset")) {
    return invalid("Paste a complete preset JSON document.", "preset");
  }

  const adoptedName = readImportedName(root.value.preset);
  const sanitizedDocument = sanitizeImportedRoot(root.value, options.provisionalPreset, adoptedName);
  return {
    valid: true,
    adoptedName,
    text: JSON.stringify(sanitizedDocument, null, 2)
  };
}

function validateControlledPresetJson(text: string, options: ControlledPresetJsonOptions): PresetJsonSuccess | PresetJsonFailure {
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
  const controlledPreset = options.controlledPreset;

  const id = expectString(preset.id, "preset.id");
  if (!id.valid) {
    return id;
  }
  if (id.value !== controlledPreset.id) {
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
  if (createdAt.value !== controlledPreset.createdAt) {
    return invalid("preset.createdAt cannot be edited.", "preset.createdAt");
  }

  const updatedAt = expectString(preset.updatedAt, "preset.updatedAt");
  if (!updatedAt.valid) {
    return updatedAt;
  }
  if (updatedAt.value !== controlledPreset.updatedAt) {
    return invalid("preset.updatedAt cannot be edited.", "preset.updatedAt");
  }

  const filters = validateFilters(preset.filters);
  if (!filters.valid) {
    return filters;
  }

  const normalizedPreset: Preset = {
    id: controlledPreset.id,
    name: options.authoritativeName,
    createdAt: controlledPreset.createdAt,
    updatedAt: controlledPreset.updatedAt,
    filters: filters.filters
  };

  const formattedText = serializePresetExport(normalizedPreset);
  return {
    valid: true,
    filters: filters.filters,
    normalizedPreset,
    synchronizedText: formattedText,
    formattedText
  };
}

function validateFilters(value: unknown): { valid: true; filters: FilterPresetItem[] } | PresetJsonFailure {
  if (!Array.isArray(value)) {
    return invalid("preset.filters must be an array.", "preset.filters");
  }
  if (value.length === 0) {
    return invalid("preset.filters: Add at least one filter.", "preset.filters");
  }

  const filters: FilterPresetItem[] = [];
  const seenTitles = new Set<string>();

  for (const [filterIndex, filterValue] of value.entries()) {
    const filterPath = `preset.filters[${filterIndex}]`;
    const filter = expectObject(filterValue, filterPath, `${filterPath} must be an object.`);
    if (!filter.valid) {
      return filter;
    }

    const title = expectString(filter.value.title, `${filterPath}.title`);
    if (!title.valid) {
      return title;
    }
    const normalizedTitle = normalizeComparable(title.value);
    if (normalizedTitle.length === 0) {
      return invalid(`${filterPath}.title: Enter a filter title.`, `${filterPath}.title`);
    }
    if (seenTitles.has(normalizedTitle)) {
      return invalid(`${filterPath}.title: Duplicate filter title.`, `${filterPath}.title`);
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
    const selectionMode = filter.value.selectionMode;
    if (selectionMode !== undefined && selectionMode !== "all" && selectionMode !== "none") {
      return invalid(`${filterPath}.selectionMode must be "all" or "none".`, `${filterPath}.selectionMode`);
    }
    if (selectionMode !== undefined && filter.value.selectedLabels.length > 0) {
      return invalid(
        `${filterPath}.selectedLabels must be empty when selectionMode is set.`,
        `${filterPath}.selectedLabels`
      );
    }
    if (filter.value.selectedLabels.length === 0 && selectionMode === undefined) {
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

    seenTitles.add(normalizedTitle);
    filters.push({
      title: title.value,
      type: "list",
      selectedLabels,
      ...(selectionMode ? { selectionMode } : {})
    });
  }

  return {
    valid: true,
    filters
  };
}

function sanitizeImportedRoot(root: JsonObject, provisionalPreset: Preset, adoptedName: string): JsonObject {
  const sanitizedRoot: JsonObject = {
    ...root
  };

  if (!isPlainObject(root.preset)) {
    return sanitizedRoot;
  }

  sanitizedRoot.preset = {
    ...root.preset,
    id: provisionalPreset.id,
    name: adoptedName,
    createdAt: provisionalPreset.createdAt,
    updatedAt: provisionalPreset.updatedAt
  };

  return sanitizedRoot;
}

function readImportedName(value: unknown): string {
  if (!isPlainObject(value) || typeof value.name !== "string") {
    return "";
  }

  return value.name;
}

function parseJson(text: string): { valid: true; value: unknown } | PresetJsonFailure {
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
): { valid: true; value: JsonObject } | PresetJsonFailure {
  if (!isPlainObject(value)) {
    return invalid(message, path);
  }

  return {
    valid: true,
    value
  };
}

function expectString(value: unknown, path: string): { valid: true; value: string } | PresetJsonFailure {
  if (typeof value !== "string") {
    return invalid(`${path} must be a string.`, path);
  }

  return {
    valid: true,
    value
  };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeComparable(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function invalid(message: string, path?: string): PresetJsonFailure {
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
