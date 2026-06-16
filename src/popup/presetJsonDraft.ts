import type { CreatePresetJsonResult, EditPresetJsonResult } from "../shared/presetJsonEditor";
import type { Preset } from "../shared/types";

type PresetJsonDraftBase<TValidation extends CreatePresetJsonResult | EditPresetJsonResult> = {
  preset: Preset;
  currentName: string;
  jsonText: string;
  validation: TValidation;
  nameSyncPending: boolean;
};

export type CreatePresetJsonDraft = PresetJsonDraftBase<CreatePresetJsonResult> & {
  kind: "create";
  nameManual: boolean;
  sessionToken: number;
};

export type EditPresetJsonDraft = PresetJsonDraftBase<EditPresetJsonResult> & {
  kind: "edit";
  originalRevision: string;
};

export type PresetJsonDraft = CreatePresetJsonDraft | EditPresetJsonDraft;

export type CreatePresetJsonDraftOptions = Omit<CreatePresetJsonDraft, "nameSyncPending"> & {
  nameSyncPending?: boolean;
};

export type EditPresetJsonDraftOptions = Omit<EditPresetJsonDraft, "nameSyncPending"> & {
  nameSyncPending?: boolean;
};

export type PresetJsonNameChange = {
  name: string;
  nameManual?: boolean;
  nameSyncPending?: boolean;
  synchronizedText?: string;
};

export function createPresetJsonDraft(options: CreatePresetJsonDraftOptions): CreatePresetJsonDraft;
export function createPresetJsonDraft(options: EditPresetJsonDraftOptions): EditPresetJsonDraft;
export function createPresetJsonDraft(options: CreatePresetJsonDraftOptions | EditPresetJsonDraftOptions): PresetJsonDraft {
  return {
    ...options,
    nameSyncPending: options.nameSyncPending ?? false
  };
}

export function applyPresetJsonValidation<TDraft extends PresetJsonDraft>(
  draft: TDraft,
  validation: TDraft["validation"],
  nextText?: string
): TDraft {
  return {
    ...draft,
    validation,
    jsonText: nextText ?? draft.jsonText
  };
}

export function markPresetJsonTextChanged<TDraft extends PresetJsonDraft>(draft: TDraft, jsonText: string): TDraft {
  return {
    ...draft,
    jsonText
  };
}

export function markPresetJsonNameChanged<TDraft extends PresetJsonDraft>(
  draft: TDraft,
  change: PresetJsonNameChange
): TDraft {
  const baseDraft = {
    ...draft,
    currentName: change.name
  };
  const nextDraft = draft.kind === "create" && change.nameManual !== undefined ? { ...baseDraft, nameManual: change.nameManual } : baseDraft;

  if (!draft.validation.valid || change.synchronizedText === undefined) {
    return {
      ...nextDraft,
      nameSyncPending: change.nameSyncPending ?? true
    } as TDraft;
  }

  return {
    ...nextDraft,
    jsonText: change.synchronizedText,
    nameSyncPending: false,
    validation: {
      ...draft.validation,
      normalizedPreset: {
        ...draft.validation.normalizedPreset,
        name: change.name
      },
      synchronizedText: change.synchronizedText,
      formattedText: change.synchronizedText
    }
  } as TDraft;
}

export function resetPresetJsonNameSync<TDraft extends PresetJsonDraft>(draft: TDraft): TDraft {
  return {
    ...draft,
    nameSyncPending: false
  };
}
