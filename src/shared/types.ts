export type FilterType = "list";

export type FilterPresetItem = {
  title: string;
  type: FilterType;
  selectedLabels: string[];
};

export type Preset = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  filters: FilterPresetItem[];
};

export type PagePresetCollection = {
  schemaVersion: 1;
  pageKey: string;
  presets: Preset[];
};

export type OperationStatus =
  | "applied"
  | "saved"
  | "skipped_unsupported"
  | "missing_filter"
  | "ambiguous_filter"
  | "missing_value"
  | "timeout"
  | "interaction_failed";

export type FilterOperationResult = {
  title: string;
  status: OperationStatus;
  message: string;
};

export type ContentRequest =
  | { type: "READ_FILTERS" }
  | { type: "APPLY_FILTERS"; filters: FilterPresetItem[] };

export type ContentResponse =
  | { ok: true; filters: FilterPresetItem[] }
  | { ok: true; results: FilterOperationResult[] }
  | { ok: false; error: string };
