import type {
  ContentRequest,
  ContentResponse,
  ContentResponseFor,
  FilterOperationResult,
  FilterPresetItem,
  OperationStatus
} from "../shared/types";

const operationStatuses = new Set<OperationStatus>([
  "applied",
  "missing_filter",
  "ambiguous_filter",
  "missing_value",
  "timeout",
  "interaction_failed"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const expectedKeys = new Set(keys);
  return Object.keys(value).every((key) => expectedKeys.has(key)) && keys.every((key) => Object.hasOwn(value, key));
}

function decodeFilters(value: unknown): FilterPresetItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const filters: FilterPresetItem[] = [];
  for (const filter of value) {
    if (
      !isRecord(filter) ||
      !hasOnlyKeys(filter, ["title", "type", "selectedLabels"]) ||
      typeof filter.title !== "string" ||
      filter.type !== "list" ||
      !Array.isArray(filter.selectedLabels) ||
      !filter.selectedLabels.every((label) => typeof label === "string")
    ) {
      return undefined;
    }
    filters.push({
      title: filter.title,
      type: "list",
      selectedLabels: [...filter.selectedLabels]
    });
  }
  return filters;
}

function decodeResults(value: unknown): FilterOperationResult[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const results: FilterOperationResult[] = [];
  for (const result of value) {
    if (
      !isRecord(result) ||
      !hasOnlyKeys(result, ["title", "status", "message"]) ||
      typeof result.title !== "string" ||
      typeof result.status !== "string" ||
      !operationStatuses.has(result.status as OperationStatus) ||
      typeof result.message !== "string"
    ) {
      return undefined;
    }
    results.push({
      title: result.title,
      status: result.status as OperationStatus,
      message: result.message
    });
  }
  return results;
}

export function decodeContentResponse<Request extends ContentRequest>(
  request: Request,
  value: unknown
): ContentResponseFor<Request> | undefined {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return undefined;
  }

  let response: ContentResponse | undefined;
  if (value.ok === false) {
    if (hasOnlyKeys(value, ["ok", "error"]) && typeof value.error === "string") {
      response = { ok: false, error: value.error };
    }
  } else if (request.type === "READ_FILTERS" && hasOnlyKeys(value, ["ok", "filters"])) {
    const filters = decodeFilters(value.filters);
    if (filters) {
      response = { ok: true, filters };
    }
  } else if (request.type === "APPLY_FILTERS" && hasOnlyKeys(value, ["ok", "results"])) {
    const results = decodeResults(value.results);
    if (results) {
      response = { ok: true, results };
    }
  }

  return response as ContentResponseFor<Request> | undefined;
}
