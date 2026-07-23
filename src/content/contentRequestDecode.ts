import type { ContentRequest, FilterPresetItem } from "../shared/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const expectedKeys = new Set(keys);
  return Object.keys(value).every((key) => expectedKeys.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}

function decodeFilter(value: unknown): FilterPresetItem | undefined {
  const keys = isRecord(value) && value.selectionMode !== undefined
    ? ["title", "type", "selectedLabels", "selectionMode"]
    : ["title", "type", "selectedLabels"];
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, keys) ||
    typeof value.title !== "string" ||
    value.type !== "list" ||
    !Array.isArray(value.selectedLabels) ||
    !value.selectedLabels.every((label) => typeof label === "string") ||
    (value.selectionMode !== undefined && value.selectionMode !== "all" && value.selectionMode !== "none") ||
    (value.selectionMode !== undefined && value.selectedLabels.length > 0)
  ) {
    return undefined;
  }

  return {
    title: value.title,
    type: "list",
    selectedLabels: [...value.selectedLabels],
    ...(value.selectionMode ? { selectionMode: value.selectionMode } : {})
  };
}

export function decodeContentRequest(value: unknown): ContentRequest | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  if (value.type === "READ_FILTERS") {
    return hasOnlyKeys(value, ["type"]) ? { type: "READ_FILTERS" } : undefined;
  }

  if (value.type === "APPLY_FILTERS" && hasOnlyKeys(value, ["type", "filters"]) && Array.isArray(value.filters)) {
    const filters: FilterPresetItem[] = [];
    for (const filterValue of value.filters) {
      const filter = decodeFilter(filterValue);
      if (!filter) {
        return undefined;
      }
      filters.push(filter);
    }
    return { type: "APPLY_FILTERS", filters };
  }

  return undefined;
}
