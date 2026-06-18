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

export type ReadFiltersRequest = { type: "READ_FILTERS" };
export type ApplyFiltersRequest = { type: "APPLY_FILTERS"; filters: FilterPresetItem[] };

export type ContentRequest = ReadFiltersRequest | ApplyFiltersRequest;

export type ContentErrorResponse = { ok: false; error: string };
export type ReadFiltersResponse = { ok: true; filters: FilterPresetItem[] } | ContentErrorResponse;
export type ApplyFiltersResponse = { ok: true; results: FilterOperationResult[] } | ContentErrorResponse;

export type ContentMessageMap = {
  READ_FILTERS: {
    request: ReadFiltersRequest;
    response: ReadFiltersResponse;
  };
  APPLY_FILTERS: {
    request: ApplyFiltersRequest;
    response: ApplyFiltersResponse;
  };
};

export type ContentResponseFor<Request extends ContentRequest> = ContentMessageMap[Request["type"]]["response"];
export type ContentResponse = ContentResponseFor<ContentRequest>;

export type SendContentRequest = {
  (request: ReadFiltersRequest): Promise<ReadFiltersResponse>;
  (request: ApplyFiltersRequest): Promise<ApplyFiltersResponse>;
};

export type ContentRequestHandler = SendContentRequest;
