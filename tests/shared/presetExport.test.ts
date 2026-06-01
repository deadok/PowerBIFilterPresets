import { describe, expect, it } from "vitest";
import { parsePresetExport, serializePresetExport } from "../../src/shared/presetExport";
import type { Preset } from "../../src/shared/types";

const samplePreset: Preset = {
  id: "preset_1",
  name: "Sales review",
  createdAt: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
};

describe("serializePresetExport", () => {
  it("serializes a preset as versioned debug JSON", () => {
    expect(JSON.parse(serializePresetExport(samplePreset))).toEqual({
      schemaVersion: 1,
      preset: samplePreset
    });
  });
});

describe("parsePresetExport", () => {
  it("parses versioned JSON strings", () => {
    expect(parsePresetExport(serializePresetExport(samplePreset))).toEqual(samplePreset);
  });

  it("parses versioned export objects", () => {
    expect(parsePresetExport({ schemaVersion: 1, preset: samplePreset })).toEqual(samplePreset);
  });

  it("parses direct preset objects", () => {
    expect(parsePresetExport(samplePreset)).toEqual(samplePreset);
  });

  it("rejects invalid JSON with a clear error", () => {
    expect(() => parsePresetExport("{not json")).toThrow("Invalid preset export JSON.");
  });

  it("rejects presets without filters", () => {
    expect(() => parsePresetExport({ ...samplePreset, filters: undefined })).toThrow(
      "Invalid preset export: preset.filters must be an array."
    );
  });
});
