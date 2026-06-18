import type { FilterOperationResult } from "../shared/types";

export type SlicerApplyResult = {
  availableLabels: string[];
  failedLabels: string[];
  missingLabels: string[];
  scanCompleted: boolean;
};

type ResolveSlicerApplyResultOptions = SlicerApplyResult & {
  logPrefix: string;
  title: string;
  desiredLabels: string[];
};

export function appliedFilterResult(title: string, selectedCount: number): FilterOperationResult {
  return {
    title,
    status: "applied",
    message: `Applied ${selectedCount} ${selectedCount === 1 ? "value" : "values"}.`
  };
}

export function missingFilterApplyResult(title: string): FilterOperationResult {
  return { title, status: "missing_filter", message: "Filter was not found." };
}

export function ambiguousFilterApplyResult(title: string): FilterOperationResult {
  return { title, status: "ambiguous_filter", message: "More than one filter matched this title." };
}

export function missingValuesApplyResult(title: string, missingLabels: string[]): FilterOperationResult {
  return { title, status: "missing_value", message: `Missing values: ${missingLabels.join(", ")}.` };
}

export function interactionFailedApplyResult(title: string, failedLabels: string[]): FilterOperationResult {
  return {
    title,
    status: "interaction_failed",
    message: `Could not update values: ${failedLabels.join(", ")}.`
  };
}

export function timeoutApplyResult(title: string): FilterOperationResult {
  return { title, status: "timeout", message: "Timed out while scanning dropdown values." };
}

export function resolveSlicerApplyResult(options: ResolveSlicerApplyResultOptions): FilterOperationResult {
  if (!options.scanCompleted) {
    console.warn(options.logPrefix, "Timed out while scanning dropdown values", {
      title: options.title,
      desiredLabels: options.desiredLabels,
      availableLabels: options.availableLabels
    });
    return timeoutApplyResult(options.title);
  }

  if (options.failedLabels.length > 0) {
    console.warn(options.logPrefix, "Filter values failed while applying preset", {
      title: options.title,
      desiredLabels: options.desiredLabels,
      failedLabels: options.failedLabels,
      availableLabels: options.availableLabels
    });
    return interactionFailedApplyResult(options.title, options.failedLabels);
  }

  if (options.missingLabels.length > 0) {
    console.warn(options.logPrefix, "Missing filter values while applying preset", {
      title: options.title,
      desiredLabels: options.desiredLabels,
      missingLabels: options.missingLabels,
      availableLabels: options.availableLabels
    });
    return missingValuesApplyResult(options.title, options.missingLabels);
  }

  return appliedFilterResult(options.title, options.desiredLabels.length);
}
