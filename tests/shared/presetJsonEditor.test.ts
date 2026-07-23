import { describe, expect, it } from "vitest";
import {
  createCreatePresetDocument,
  createEditPresetDocument,
  formatEditPresetJson,
  formatCreatePresetJson,
  resetEditPresetJson,
  sanitizeImportedPresetDocument,
  validateCreatePresetJson,
  validateEditPresetJson
} from "../../src/shared/presetJsonEditor";
import { createPresetRevision, isPresetRevisionMatch } from "../../src/shared/presetRevision";
import type { Preset } from "../../src/shared/types";

const samplePreset: Preset = {
  id: "preset_1",
  name: "Weekly sales review",
  createdAt: "2026-06-08T10:00:00.000Z",
  updatedAt: "2026-06-08T10:00:00.000Z",
  filters: [
    {
      title: "Region",
      type: "list",
      selectedLabels: ["North", "Central"]
    }
  ]
};

function editValidation(text: string, name = samplePreset.name) {
  return validateEditPresetJson(text, {
    preset: samplePreset,
    authoritativeName: name,
    allowNameMismatch: name !== samplePreset.name
  });
}

describe("presetJsonEditor", () => {
  it("creates a versioned create template with provisional identity and empty filters", () => {
    const created = createCreatePresetDocument({
      id: "provisional-id",
      createdAt: "2026-06-11T08:00:00.000Z",
      updatedAt: "2026-06-11T08:00:00.000Z"
    });

    expect(JSON.parse(created)).toEqual({
      schemaVersion: 1,
      preset: {
        id: "provisional-id",
        name: "",
        createdAt: "2026-06-11T08:00:00.000Z",
        updatedAt: "2026-06-11T08:00:00.000Z",
        filters: []
      }
    });
  });

  it("requires at least one filter when validating a new preset document", () => {
    expect(
      validateCreatePresetJson(
        createCreatePresetDocument({
          id: samplePreset.id,
          createdAt: samplePreset.createdAt,
          updatedAt: samplePreset.updatedAt
        }),
        {
          provisionalPreset: {
            ...samplePreset,
            name: ""
          },
          authoritativeName: ""
        }
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.filters",
        message: "preset.filters: Add at least one filter."
      }
    });
  });

  it("creates the full versioned edit document", () => {
    expect(JSON.parse(createEditPresetDocument(samplePreset))).toEqual({
      schemaVersion: 1,
      preset: samplePreset
    });
  });

  it("accepts an explicit all selection mode with no localized selected label", () => {
    const modePreset: Preset = {
      ...samplePreset,
      filters: [{ title: "Region", type: "list", selectedLabels: [], selectionMode: "all" }]
    };

    const validation = validateEditPresetJson(createEditPresetDocument(modePreset), {
      preset: modePreset,
      authoritativeName: modePreset.name
    });

    expect(validation).toMatchObject({ valid: true, filters: modePreset.filters });
  });

  it("rejects selected labels that contradict an explicit selection mode", () => {
    const contradictoryPreset: Preset = {
      ...samplePreset,
      filters: [{ title: "Region", type: "list", selectedLabels: ["North"], selectionMode: "all" }]
    };

    expect(
      validateEditPresetJson(createEditPresetDocument(contradictoryPreset), {
        preset: contradictoryPreset,
        authoritativeName: contradictoryPreset.name
      })
    ).toEqual({
      valid: false,
      error: {
        path: "preset.filters[0].selectedLabels",
        message: "preset.filters[0].selectedLabels must be empty when selectionMode is set."
      }
    });
  });

  it("synchronizes the name field into otherwise valid JSON", () => {
    const validation = editValidation(createEditPresetDocument(samplePreset), "Quarterly review");

    expect(validation).toMatchObject({
      valid: true,
      normalizedPreset: {
        ...samplePreset,
        name: "Quarterly review"
      },
      filters: samplePreset.filters
    });
    if (!validation.valid) {
      throw new Error("Expected valid JSON.");
    }
    expect(JSON.parse(validation.synchronizedText)).toMatchObject({
      preset: {
        name: "Quarterly review"
      }
    });
  });

  it("rejects direct JSON edits to preset.name", () => {
    const edited = createEditPresetDocument({
      ...samplePreset,
      name: "Edited in JSON"
    });

    expect(editValidation(edited)).toEqual({
      valid: false,
      error: {
        path: "preset.name",
        message: "Edit the preset name using the name field."
      }
    });
  });

  it("rejects edits to protected schema and lifecycle fields", () => {
    expect(
      editValidation(
        JSON.stringify(
          {
            schemaVersion: 2,
            preset: samplePreset
          },
          null,
          2
        )
      )
    ).toEqual({
      valid: false,
      error: {
        path: "schemaVersion",
        message: "schemaVersion: only version 1 is supported."
      }
    });

    expect(
      editValidation(
        createEditPresetDocument({
          ...samplePreset,
          id: "changed"
        })
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.id",
        message: "preset.id cannot be edited."
      }
    });

    expect(
      editValidation(
        createEditPresetDocument({
          ...samplePreset,
          createdAt: "2026-06-09T10:00:00.000Z"
        })
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.createdAt",
        message: "preset.createdAt cannot be edited."
      }
    });

    expect(
      editValidation(
        createEditPresetDocument({
          ...samplePreset,
          updatedAt: "2026-06-09T10:00:00.000Z"
        })
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.updatedAt",
        message: "preset.updatedAt cannot be edited."
      }
    });
  });

  it("reports syntax errors with line and column details", () => {
    expect(editValidation('{\n  "schemaVersion": 1,\n')).toEqual({
      valid: false,
      error: {
        message: "Invalid JSON at line 3 column 1."
      }
    });
  });

  it("rejects missing required paths and unsupported filter types", () => {
    expect(editValidation(JSON.stringify({ schemaVersion: 1 }, null, 2))).toEqual({
      valid: false,
      error: {
        path: "preset",
        message: "preset must be an object."
      }
    });

    expect(
      editValidation(
        JSON.stringify(
          {
            schemaVersion: 1,
            preset: {
              ...samplePreset,
              filters: [{ title: "Region", type: "range", selectedLabels: ["North"] }]
            }
          },
          null,
          2
        )
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.filters[0].type",
        message: 'preset.filters[0].type: only "list" is supported.'
      }
    });
  });

  it("rejects empty titles, empty labels, and normalized duplicates", () => {
    expect(
      editValidation(
        JSON.stringify(
          {
            schemaVersion: 1,
            preset: {
              ...samplePreset,
              filters: [{ title: "  ", type: "list", selectedLabels: ["North"] }]
            }
          },
          null,
          2
        )
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.filters[0].title",
        message: "preset.filters[0].title: Enter a filter title."
      }
    });

    expect(
      editValidation(
        JSON.stringify(
          {
            schemaVersion: 1,
            preset: {
              ...samplePreset,
              filters: [{ title: "Region", type: "list", selectedLabels: ["", "North"] }]
            }
          },
          null,
          2
        )
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.filters[0].selectedLabels[0]",
        message: "preset.filters[0].selectedLabels[0]: Enter a selected label."
      }
    });

    expect(
      editValidation(
        JSON.stringify(
          {
            schemaVersion: 1,
            preset: {
              ...samplePreset,
              filters: [
                { title: " Region ", type: "list", selectedLabels: ["North"] },
                { title: "region", type: "list", selectedLabels: ["South"] }
              ]
            }
          },
          null,
          2
        )
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.filters[1].title",
        message: "preset.filters[1].title: Duplicate filter title."
      }
    });

    expect(
      editValidation(
        JSON.stringify(
          {
            schemaVersion: 1,
            preset: {
              ...samplePreset,
              filters: [{ title: "Region", type: "list", selectedLabels: [" North ", "north"] }]
            }
          },
          null,
          2
        )
      )
    ).toEqual({
      valid: false,
      error: {
        path: "preset.filters[0].selectedLabels[1]",
        message: "preset.filters[0].selectedLabels[1]: Duplicate selected label."
      }
    });
  });

  it("preserves valid filter and label order through validation and formatting", () => {
    const text = JSON.stringify(
      {
        schemaVersion: 1,
        preset: {
          ...samplePreset,
          filters: [
            { title: "Team", type: "list", selectedLabels: ["Бета", "Альфа"] },
            { title: "Region", type: "list", selectedLabels: ["South", "North"] }
          ]
        }
      },
      null,
      2
    );

    const validation = editValidation(text, "План продаж");
    expect(validation).toMatchObject({
      valid: true,
      filters: [
        { title: "Team", type: "list", selectedLabels: ["Бета", "Альфа"] },
        { title: "Region", type: "list", selectedLabels: ["South", "North"] }
      ]
    });
    expect(
      JSON.parse(
        formatEditPresetJson(text, {
          preset: samplePreset,
          authoritativeName: "План продаж",
          allowNameMismatch: true
        })
      )
    ).toEqual(JSON.parse((validation as Extract<typeof validation, { valid: true }>).formattedText));
  });

  it("resets JSON back to the opened preset while preserving the current name field", () => {
    expect(JSON.parse(resetEditPresetJson(samplePreset, "Current name"))).toMatchObject({
      preset: {
        ...samplePreset,
        name: "Current name"
      }
    });
  });

  it("sanitizes imported source identity metadata while keeping the pasted name and document shape", () => {
    const imported = sanitizeImportedPresetDocument(createEditPresetDocument(samplePreset), {
      provisionalPreset: {
        id: "new-provisional-id",
        name: "",
        createdAt: "2026-06-11T09:00:00.000Z",
        updatedAt: "2026-06-11T09:00:00.000Z",
        filters: []
      }
    });

    expect(imported).toEqual({
      valid: true,
      adoptedName: "Weekly sales review",
      text: JSON.stringify(
        {
          schemaVersion: 1,
          preset: {
            id: "new-provisional-id",
            name: "Weekly sales review",
            createdAt: "2026-06-11T09:00:00.000Z",
            updatedAt: "2026-06-11T09:00:00.000Z",
            filters: samplePreset.filters
          }
        },
        null,
        2
      )
    });
  });

  it("loads parseable semantic-invalid imported JSON for correction", () => {
    const imported = sanitizeImportedPresetDocument(
      JSON.stringify(
        {
          schemaVersion: 2,
          preset: {
            ...samplePreset,
            filters: []
          }
        },
        null,
        2
      ),
      {
        provisionalPreset: {
          id: "new-provisional-id",
          name: "",
          createdAt: "2026-06-11T09:00:00.000Z",
          updatedAt: "2026-06-11T09:00:00.000Z",
          filters: []
        }
      }
    );

    expect(imported).toMatchObject({
      valid: true,
      adoptedName: "Weekly sales review"
    });
    if (!imported.valid) {
      throw new Error("Expected imported JSON to load.");
    }
    expect(JSON.parse(imported.text)).toMatchObject({
      schemaVersion: 2,
      preset: {
        id: "new-provisional-id",
        createdAt: "2026-06-11T09:00:00.000Z",
        updatedAt: "2026-06-11T09:00:00.000Z",
        filters: []
      }
    });
  });

  it("rejects non-versioned imported JSON without replacing the current draft", () => {
    expect(
      sanitizeImportedPresetDocument(JSON.stringify(samplePreset, null, 2), {
        provisionalPreset: {
          id: "new-provisional-id",
          name: "",
          createdAt: "2026-06-11T09:00:00.000Z",
          updatedAt: "2026-06-11T09:00:00.000Z",
          filters: []
        }
      })
    ).toEqual({
      valid: false,
      error: {
        path: "preset",
        message: "Paste a complete preset JSON document."
      }
    });
  });

  it("formats valid create JSON using the shared formatter", () => {
    const text =
      '{"schemaVersion":1,"preset":{"id":"provisional-id","name":"План продаж","createdAt":"2026-06-11T08:00:00.000Z","updatedAt":"2026-06-11T08:00:00.000Z","filters":[{"title":"Team","type":"list","selectedLabels":["Бета","Альфа"]}]}}';

    expect(
      JSON.parse(
        formatCreatePresetJson(text, {
          provisionalPreset: {
            id: "provisional-id",
            name: "",
            createdAt: "2026-06-11T08:00:00.000Z",
            updatedAt: "2026-06-11T08:00:00.000Z",
            filters: []
          },
          authoritativeName: "План продаж"
        })
      )
    ).toEqual({
      schemaVersion: 1,
      preset: {
        id: "provisional-id",
        name: "План продаж",
        createdAt: "2026-06-11T08:00:00.000Z",
        updatedAt: "2026-06-11T08:00:00.000Z",
        filters: [{ title: "Team", type: "list", selectedLabels: ["Бета", "Альфа"] }]
      }
    });
  });
});

describe("presetRevision", () => {
  it("matches only unchanged preset snapshots", () => {
    const revision = createPresetRevision(samplePreset);

    expect(isPresetRevisionMatch(samplePreset, revision)).toBe(true);
    expect(isPresetRevisionMatch({ ...samplePreset, updatedAt: "2026-06-09T10:00:00.000Z" }, revision)).toBe(false);
    expect(
      isPresetRevisionMatch(
        {
          ...samplePreset,
          filters: [{ ...samplePreset.filters[0], selectedLabels: [...samplePreset.filters[0].selectedLabels].reverse() }]
        },
        revision
      )
    ).toBe(false);
  });
});
