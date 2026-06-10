import { describe, expect, it } from "vitest";
import {
  DUPLICATE_PRESET_NAME_ERROR,
  REQUIRED_PRESET_NAME_ERROR,
  normalizePresetName,
  validatePresetName
} from "../../src/popup/presetNameValidation";
import type { PagePresetCollection, Preset } from "../../src/shared/types";

function preset(id: string, name: string): Preset {
  return {
    id,
    name,
    createdAt: "2026-06-10T10:00:00.000Z",
    updatedAt: "2026-06-10T10:00:00.000Z",
    filters: []
  };
}

function collection(pageKey: string, presets: Preset[]): PagePresetCollection {
  return {
    schemaVersion: 1,
    pageKey,
    presets
  };
}

describe("normalizePresetName", () => {
  it("trims and compares names case-insensitively", () => {
    expect(normalizePresetName("  Sales Review  ")).toBe(normalizePresetName("sales review"));
  });
});

describe("validatePresetName", () => {
  it("rejects a name that is empty after trimming", () => {
    expect(validatePresetName(" \n\t ", collection("report-a", []))).toEqual({
      valid: false,
      error: REQUIRED_PRESET_NAME_ERROR
    });
  });

  it("returns the trimmed display name when valid", () => {
    expect(validatePresetName("  Sales Review  ", collection("report-a", []))).toEqual({
      valid: true,
      name: "Sales Review"
    });
  });

  it("rejects a duplicate after trimming and case-insensitive comparison", () => {
    const currentCollection = collection("report-a", [preset("one", "Sales Review")]);

    expect(validatePresetName("  SALES REVIEW ", currentCollection)).toEqual({
      valid: false,
      error: DUPLICATE_PRESET_NAME_ERROR
    });
  });

  it("checks only the supplied current-report collection", () => {
    const otherReport = collection("report-b", [preset("one", "Sales Review")]);
    const currentReport = collection("report-a", []);

    expect(validatePresetName("sales review", otherReport).valid).toBe(false);
    expect(validatePresetName("sales review", currentReport)).toEqual({
      valid: true,
      name: "sales review"
    });
  });

  it("excludes the renamed preset id from duplicate comparison", () => {
    const currentCollection = collection("report-a", [
      preset("one", "Sales Review"),
      preset("two", "Operations")
    ]);

    expect(validatePresetName(" sales review ", currentCollection, "one")).toEqual({
      valid: true,
      name: "sales review"
    });
    expect(validatePresetName(" operations ", currentCollection, "one")).toEqual({
      valid: false,
      error: DUPLICATE_PRESET_NAME_ERROR
    });
  });

  it("does not migrate or rewrite legacy duplicate names", () => {
    const currentCollection = collection("report-a", [
      preset("one", "Legacy"),
      preset("two", " legacy ")
    ]);
    const originalNames = currentCollection.presets.map(({ name }) => name);

    validatePresetName("New name", currentCollection);

    expect(currentCollection.presets.map(({ name }) => name)).toEqual(originalNames);
  });
});
