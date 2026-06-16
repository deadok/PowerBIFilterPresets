import { describe, expect, it } from "vitest";
import {
  applyPresetJsonValidation,
  createPresetJsonDraft,
  markPresetJsonNameChanged,
  markPresetJsonTextChanged,
  resetPresetJsonNameSync
} from "../../src/popup/presetJsonDraft";
import type { CreatePresetJsonResult } from "../../src/shared/presetJsonEditor";
import type { FilterPresetItem, Preset } from "../../src/shared/types";

const filters: FilterPresetItem[] = [{ title: "Region", type: "list", selectedLabels: ["EMEA"] }];

const preset: Preset = {
  id: "preset-1",
  name: "Sales review",
  createdAt: "2026-06-09T10:00:00.000Z",
  updatedAt: "2026-06-09T10:00:00.000Z",
  filters
};

function validResult(name: string): CreatePresetJsonResult {
  return {
    valid: true,
    filters,
    normalizedPreset: {
      ...preset,
      name
    },
    synchronizedText: `sync:${name}`,
    formattedText: `format:${name}`
  };
}

function invalidResult(message: string): CreatePresetJsonResult {
  return {
    valid: false,
    error: { message }
  };
}

describe("preset JSON draft", () => {
  it("creates a draft with shared JSON state and mode-specific metadata", () => {
    const validation = validResult("");
    const draft = createPresetJsonDraft({
      kind: "create",
      preset,
      currentName: "",
      jsonText: "initial",
      validation,
      nameManual: false,
      sessionToken: 7
    });

    expect(draft).toEqual({
      kind: "create",
      preset,
      currentName: "",
      jsonText: "initial",
      validation,
      nameManual: false,
      nameSyncPending: false,
      sessionToken: 7
    });
  });

  it("stores synchronized JSON text returned by validation", () => {
    const draft = createPresetJsonDraft({
      kind: "edit",
      preset,
      originalRevision: "revision-1",
      currentName: "Sales review",
      jsonText: "initial",
      validation: invalidResult("Invalid JSON")
    });

    const nextDraft = applyPresetJsonValidation(draft, validResult("Renamed"), "synchronized");

    expect(nextDraft).toMatchObject({
      validation: validResult("Renamed"),
      jsonText: "synchronized"
    });
    expect(draft.jsonText).toBe("initial");
  });

  it("records free-form JSON edits without changing validation", () => {
    const validation = validResult("Sales review");
    const draft = createPresetJsonDraft({
      kind: "edit",
      preset,
      originalRevision: "revision-1",
      currentName: "Sales review",
      jsonText: "initial",
      validation
    });

    expect(markPresetJsonTextChanged(draft, "typed")).toMatchObject({
      jsonText: "typed",
      validation
    });
  });

  it("synchronizes a changed name into valid JSON and clears pending sync", () => {
    const draft = createPresetJsonDraft({
      kind: "create",
      preset,
      currentName: "",
      jsonText: "initial",
      validation: validResult(""),
      nameManual: false,
      sessionToken: 1
    });

    const renamed = markPresetJsonNameChanged(draft, {
      name: "Created from JSON",
      nameManual: true,
      synchronizedText: "renamed-json"
    });

    expect(renamed).toMatchObject({
      currentName: "Created from JSON",
      jsonText: "renamed-json",
      nameManual: true,
      nameSyncPending: false,
      validation: {
        valid: true,
        normalizedPreset: expect.objectContaining({ name: "Created from JSON" }),
        synchronizedText: "renamed-json",
        formattedText: "renamed-json"
      }
    });
  });

  it("marks invalid drafts as needing a future name sync", () => {
    const draft = createPresetJsonDraft({
      kind: "edit",
      preset,
      originalRevision: "revision-1",
      currentName: "Sales review",
      jsonText: "invalid",
      validation: invalidResult("Invalid JSON")
    });

    expect(markPresetJsonNameChanged(draft, { name: "Renamed" })).toMatchObject({
      currentName: "Renamed",
      nameSyncPending: true,
      validation: invalidResult("Invalid JSON")
    });
  });

  it("preserves an explicit decision that the name does not need JSON resync", () => {
    const draft = createPresetJsonDraft({
      kind: "edit",
      preset,
      originalRevision: "revision-1",
      currentName: "Sales review",
      jsonText: "invalid",
      validation: invalidResult("Edit the preset name using the name field.")
    });

    expect(markPresetJsonNameChanged(draft, { name: "Sales review", nameSyncPending: false })).toMatchObject({
      currentName: "Sales review",
      nameSyncPending: false
    });
  });

  it("can explicitly clear pending name sync after validation succeeds", () => {
    const draft = createPresetJsonDraft({
      kind: "edit",
      preset,
      originalRevision: "revision-1",
      currentName: "Sales review",
      jsonText: "invalid",
      validation: invalidResult("Invalid JSON")
    });

    const pending = markPresetJsonNameChanged(draft, { name: "Renamed" });

    expect(resetPresetJsonNameSync(pending).nameSyncPending).toBe(false);
  });
});
