import { describe, expect, it } from "vitest";
import { parsePresetExport as parseContentPresetExport } from "../../src/content/presetExportParse";
import { parsePresetExport } from "../../src/shared/presetExportDecode";
import type { Preset } from "../../src/shared/types";

const samplePreset: Preset = {
  id: "preset_1",
  name: "Sales review",
  createdAt: "2026-05-28T10:00:00.000Z",
  updatedAt: "2026-05-28T10:00:00.000Z",
  filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }]
};

const parsers = [
  ["shared", parsePresetExport],
  ["content", parseContentPresetExport]
] as const;

describe.each(parsers)("%s preset export parser", (_name, parse) => {
  it("accepts current-version documents and legacy direct presets", () => {
    expect(parse({ schemaVersion: 1, preset: samplePreset })).toEqual(samplePreset);
    expect(parse(JSON.stringify({ schemaVersion: 1, preset: samplePreset }))).toEqual(samplePreset);
    expect(parse(samplePreset)).toEqual(samplePreset);
  });

  it.each([
    ["{not json", "Invalid preset export JSON."],
    [null, "Invalid preset export: expected an object."],
    [{ schemaVersion: 2, preset: samplePreset }, "Invalid preset export: schemaVersion must be 1."],
    [{ schemaVersion: 1, preset: null }, "Invalid preset export: preset must be an object."],
    [{ ...samplePreset, id: 4 }, "Invalid preset export: preset.id must be a string."],
    [{ ...samplePreset, name: false }, "Invalid preset export: preset.name must be a string."],
    [{ ...samplePreset, createdAt: null }, "Invalid preset export: preset.createdAt must be a string."],
    [{ ...samplePreset, updatedAt: 4 }, "Invalid preset export: preset.updatedAt must be a string."],
    [{ ...samplePreset, filters: null }, "Invalid preset export: preset.filters must be an array."],
    [
      { ...samplePreset, filters: [null] },
      "Invalid preset export: preset.filters[0] must be an object."
    ],
    [
      { ...samplePreset, filters: [{ title: 4, type: "list", selectedLabels: [] }] },
      "Invalid preset export: preset.filters[0].title must be a string."
    ],
    [
      { ...samplePreset, filters: [{ title: "Region", type: "range", selectedLabels: [] }] },
      'Invalid preset export: preset.filters[0].type must be "list".'
    ],
    [
      { ...samplePreset, filters: [{ title: "Region", type: "list", selectedLabels: "EMEA" }] },
      "Invalid preset export: preset.filters[0].selectedLabels must be an array."
    ],
    [
      { ...samplePreset, filters: [{ title: "Region", type: "list", selectedLabels: ["EMEA", 4] }] },
      "Invalid preset export: preset.filters[0].selectedLabels[1] must be a string."
    ]
  ])("rejects invalid input with a stable error", (input, message) => {
    expect(() => parse(input)).toThrow(message);
  });

  it("constructs a clean preset without unknown properties", () => {
    expect(
      parse({
        schemaVersion: 1,
        ignored: true,
        preset: {
          ...samplePreset,
          ignored: true,
          filters: [{ ...samplePreset.filters[0], ignored: true }]
        }
      })
    ).toEqual(samplePreset);
  });
});
