import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ambiguousFilterApplyResult,
  appliedFilterResult,
  missingFilterApplyResult,
  missingValuesApplyResult,
  resolveSlicerApplyResult,
  timeoutApplyResult
} from "../../src/content/powerBiApplyResults";

describe("Power BI apply result policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats basic apply result messages", () => {
    expect(appliedFilterResult("Product", 0)).toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 0 values."
    });
    expect(appliedFilterResult("Product", 1)).toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 1 value."
    });
    expect(appliedFilterResult("Product", 2)).toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 2 values."
    });
  });

  it("formats missing and ambiguous filter failures", () => {
    expect(missingFilterApplyResult("Product")).toEqual({
      title: "Product",
      status: "missing_filter",
      message: "Filter was not found."
    });
    expect(ambiguousFilterApplyResult("Product")).toEqual({
      title: "Product",
      status: "ambiguous_filter",
      message: "More than one filter matched this title."
    });
    expect(missingValuesApplyResult("Product", ["A", "B"])).toEqual({
      title: "Product",
      status: "missing_value",
      message: "Missing values: A, B."
    });
    expect(timeoutApplyResult("Product")).toEqual({
      title: "Product",
      status: "timeout",
      message: "Timed out while scanning dropdown values."
    });
  });

  it("maps slicer selection outcomes to stable statuses and logs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      resolveSlicerApplyResult({
        logPrefix: "[test]",
        title: "Product",
        desiredLabels: ["A"],
        availableLabels: ["A"],
        failedLabels: [],
        missingLabels: [],
        scanCompleted: false
      })
    ).toEqual({
      title: "Product",
      status: "timeout",
      message: "Timed out while scanning dropdown values."
    });

    expect(
      resolveSlicerApplyResult({
        logPrefix: "[test]",
        title: "Product",
        desiredLabels: ["A"],
        availableLabels: ["A"],
        failedLabels: ["A"],
        missingLabels: [],
        scanCompleted: true
      })
    ).toEqual({
      title: "Product",
      status: "interaction_failed",
      message: "Could not update values: A."
    });

    expect(
      resolveSlicerApplyResult({
        logPrefix: "[test]",
        title: "Product",
        desiredLabels: ["A", "B"],
        availableLabels: ["A"],
        failedLabels: [],
        missingLabels: ["B"],
        scanCompleted: true
      })
    ).toEqual({
      title: "Product",
      status: "missing_value",
      message: "Missing values: B."
    });

    expect(
      resolveSlicerApplyResult({
        logPrefix: "[test]",
        title: "Product",
        desiredLabels: ["A", "B"],
        availableLabels: ["A", "B"],
        failedLabels: [],
        missingLabels: [],
        scanCompleted: true
      })
    ).toEqual({
      title: "Product",
      status: "applied",
      message: "Applied 2 values."
    });

    expect(warn).toHaveBeenCalledTimes(3);
  });
});
