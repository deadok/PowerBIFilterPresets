import type {
  ApplyFiltersRequest,
  ApplyFiltersResponse,
  ContentResponseFor,
  ReadFiltersRequest,
  ReadFiltersResponse,
  SendContentRequest
} from "../../src/shared/types";

const readSuccess: ContentResponseFor<ReadFiltersRequest> = { ok: true, filters: [] };
const applySuccess: ContentResponseFor<ApplyFiltersRequest> = { ok: true, results: [] };
const readFailure: ContentResponseFor<ReadFiltersRequest> = { ok: false, error: "Read failed." };
const applyFailure: ContentResponseFor<ApplyFiltersRequest> = { ok: false, error: "Apply failed." };

void readSuccess;
void applySuccess;
void readFailure;
void applyFailure;

// @ts-expect-error READ_FILTERS responses cannot contain apply results.
const invalidReadResponse: ContentResponseFor<ReadFiltersRequest> = { ok: true, results: [] };

// @ts-expect-error APPLY_FILTERS responses cannot contain captured filters.
const invalidApplyResponse: ContentResponseFor<ApplyFiltersRequest> = { ok: true, filters: [] };

void invalidReadResponse;
void invalidApplyResponse;

declare const sendContentRequest: SendContentRequest;

const readPromise = sendContentRequest({ type: "READ_FILTERS" });
const applyPromise = sendContentRequest({ type: "APPLY_FILTERS", filters: [] });

const expectedReadPromise: Promise<ReadFiltersResponse> = readPromise;
const expectedApplyPromise: Promise<ApplyFiltersResponse> = applyPromise;

void expectedReadPromise;
void expectedApplyPromise;

// @ts-expect-error READ_FILTERS cannot produce an apply response.
const invalidReadPromise: Promise<ApplyFiltersResponse> = readPromise;

// @ts-expect-error APPLY_FILTERS cannot produce a read response.
const invalidApplyPromise: Promise<ReadFiltersResponse> = applyPromise;

// @ts-expect-error APPLY_FILTERS requires filters.
sendContentRequest({ type: "APPLY_FILTERS" });

// @ts-expect-error READ_FILTERS does not accept filters.
sendContentRequest({ type: "READ_FILTERS", filters: [] });

void invalidReadPromise;
void invalidApplyPromise;
