import type { FilterOperationResult, FilterPresetItem } from "../shared/types";
import {
  ambiguousFilterApplyResult,
  appliedFilterResult,
  missingFilterApplyResult,
  missingValuesApplyResult,
  resolveSlicerApplyResult,
  type SlicerApplyResult
} from "./powerBiApplyResults";
import {
  externalSlicerOptions,
  hasAllComboboxSummary,
  hasGenericMultiSelectSummary,
  hasSlicerValueOption,
  isElementExplicitlyHidden,
  isMultiSelectSlicerListbox,
  isSlicerOptionSelected,
  labelForCheckbox,
  labelForSlicerOption,
  listFilterControls,
  matchingControls,
  optionsInListbox,
  selectedLabelsFromComboboxSummary,
  selectedLabelsFromSlicerOptions,
  slicerOptions,
  type ListControl,
  type SlicerControl
} from "./powerBiDiscovery";
import { activateElement, closeDropdownOpenedForRead } from "./powerBiInteraction";
import { defaultPowerBiTiming, type PowerBiTiming } from "./powerBiTiming";
import {
  liveSlicerListboxes,
  liveSlicerOptionByLabel,
  scanSlicerOptions,
  type SlicerScanObservation
} from "./powerBiVirtualizedOptions";

type PowerBiDomAdapter = {
  waitForFilterControls(options?: { timeoutMs?: number; intervalMs?: number }): Promise<boolean>;
  readListFilters(): Promise<FilterPresetItem[]>;
  applyListFilterSelection(
    title: string,
    selectedLabels: string[],
    selectionMode?: FilterPresetItem["selectionMode"]
  ): Promise<FilterOperationResult>;
};

type PowerBiDomAdapterOptions = {
  timing?: PowerBiTiming;
};

type SelectionTransition = {
  label: string;
  beforeSelected: boolean;
  clickAttempted: boolean;
  afterSelected: boolean;
};

type CapturedSelection = Pick<FilterPresetItem, "selectedLabels" | "selectionMode"> & {
  scanIncomplete?: boolean;
};

// One absolute per-slicer deadline shared by capture resolve, optional reopen, and scanning.
const CAPTURE_DROPDOWN_OPTIONS_TIMEOUT_MS = 3000;
const FILTER_CONTROL_READINESS_TIMEOUT_MS = 8000;
// One absolute per-filter deadline shared by resolve, discovery, mutation, verification, and fallbacks.
const APPLY_FILTER_TIMEOUT_MS = 9000;
const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
const SLICER_SELECTION_VERIFY_TIMEOUT_MS = 250;
const LOG_PREFIX = "[Power BI Presets]";

function closeSlicerDropdown(
  combobox: HTMLElement,
  timing: PowerBiTiming,
  options: { title?: string } = {}
): Promise<void> {
  return closeDropdownOpenedForRead(combobox, {
    delay: timing.delay,
    logPrefix: LOG_PREFIX,
    title: options.title
  });
}

async function resolveSlicerOptions(
  root: ParentNode,
  control: SlicerControl,
  timing: PowerBiTiming,
  options: {
    deadline?: number;
    dropdownOptionsIntervalMs?: number;
    clearSearchBeforeResolve?: boolean;
    forceOpenDropdown?: boolean;
    onOpened?: (combobox: HTMLElement) => void;
    onResolvedExternalOptions?: (optionCount: number) => void;
    onWaitingForExternalOptions?: (timeoutMs: number, intervalMs: number) => void;
  }
): Promise<HTMLElement[]> {
  const inlineOptions = slicerOptions(control).filter(
    (option) => !options.clearSearchBeforeResolve || !isElementExplicitlyHidden(option)
  );
  if (!options.forceOpenDropdown && inlineOptions.length > 0) {
    return inlineOptions;
  }

  const dropdownDocument = control.element.ownerDocument;
  const dropdownRoots = [root, dropdownDocument];
  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  const externalOptionsForResolve = () => {
    const resolvedOptions = externalSlicerOptions(dropdownRoots, control.title, combobox);
    return options.clearSearchBeforeResolve
      ? resolvedOptions.filter((option) => !isElementExplicitlyHidden(option))
      : resolvedOptions;
  };
  if (options.clearSearchBeforeResolve) {
    clearControlledSlicerSearch(control);
  }
  const existingExternalOptions = externalOptionsForResolve();
  if (!options.forceOpenDropdown && existingExternalOptions.length > 0 && hasSlicerValueOption(existingExternalOptions)) {
    return existingExternalOptions;
  }

  if (!combobox) {
    return [];
  }

  const existingExternalListbox = options.clearSearchBeforeResolve
    ? controlledSlicerListbox(control, { visibleOnly: true })
    : existingExternalOptions[0]?.closest<HTMLElement>('[role="listbox"]');
  const canReuseOpenPopup =
    options.clearSearchBeforeResolve && !options.forceOpenDropdown && existingExternalListbox?.isConnected;
  if (!canReuseOpenPopup) {
    activateElement(combobox, { preferMouseEvents: true });
    options.onOpened?.(combobox);
  }
  if (options.clearSearchBeforeResolve) {
    clearControlledSlicerSearch(control);
  }
  const intervalMs = options.dropdownOptionsIntervalMs ?? DROPDOWN_OPTIONS_INTERVAL_MS;
  const deadline = options.deadline ?? timing.now() + CAPTURE_DROPDOWN_OPTIONS_TIMEOUT_MS;
  let externalOptions = externalOptionsForResolve();
  options.onWaitingForExternalOptions?.(Math.max(0, deadline - timing.now()), intervalMs);

  while (!hasSlicerValueOption(externalOptions) && timing.now() < deadline) {
    const remainingMs = deadline - timing.now();
    await timing.delay(Math.min(Math.max(1, intervalMs), remainingMs));
    externalOptions = externalOptionsForResolve();
  }

  options.onResolvedExternalOptions?.(externalOptions.length);

  return externalOptions;
}

function controlledSlicerListbox(
  control: SlicerControl,
  options: { visibleOnly?: boolean } = {}
): HTMLElement | null {
  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  const controlledIds = combobox?.getAttribute("aria-controls")?.trim().split(/\s+/).filter(Boolean) ?? [];

  for (const id of controlledIds) {
    const popup = combobox?.ownerDocument.getElementById(id);
    if (!popup?.isConnected || (options.visibleOnly && isElementExplicitlyHidden(popup))) {
      continue;
    }
    const listbox = popup.querySelector<HTMLElement>('[role="listbox"]');
    if (listbox && (!options.visibleOnly || !isElementExplicitlyHidden(listbox))) {
      return listbox;
    }
  }

  return null;
}

function controlledSlicerSearchInput(control: SlicerControl): HTMLInputElement | null {
  return controlledSlicerListbox(control, { visibleOnly: true })
    ?.closest<HTMLElement>(".slicerContainer")
    ?.querySelector<HTMLInputElement>(".searchHeader.show input.searchInput") ?? null;
}

function clearControlledSlicerSearch(control: SlicerControl): boolean {
  const input = controlledSlicerSearchInput(control);
  if (!input || input.value.length === 0) {
    return false;
  }

  const InputConstructor = input.ownerDocument.defaultView?.HTMLInputElement;
  const nativeValueSetter = InputConstructor
    ? Object.getOwnPropertyDescriptor(InputConstructor.prototype, "value")?.set
    : undefined;
  if (nativeValueSetter) {
    nativeValueSetter.call(input, "");
  } else {
    input.value = "";
  }

  const InputEventConstructor = input.ownerDocument.defaultView?.InputEvent;
  input.dispatchEvent(
    typeof InputEventConstructor === "function"
      ? new InputEventConstructor("input", {
          bubbles: true,
          cancelable: false,
          data: null,
          inputType: "deleteContentBackward"
        })
      : new Event("input", { bubbles: true })
  );
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function logSelectionTransition(
  message: string,
  title: string,
  controlKind: ListControl["kind"],
  transition: SelectionTransition,
  desiredSelected: boolean
): void {
  const details = {
    title,
    controlKind,
    label: transition.label,
    beforeSelected: transition.beforeSelected,
    clickAttempted: transition.clickAttempted,
    afterSelected: transition.afterSelected
  };

  console.debug(LOG_PREFIX, message, details);

  if (transition.afterSelected !== desiredSelected) {
    console.warn(LOG_PREFIX, "Filter value state did not match requested selection", {
      ...details,
      requestedSelected: desiredSelected
    });
  }
}

function setCheckbox(checkbox: HTMLInputElement, checked: boolean): SelectionTransition {
  const label = labelForCheckbox(checkbox);
  const beforeSelected = checkbox.checked || checkbox.getAttribute("aria-checked") === "true";
  const clickAttempted = beforeSelected !== checked;

  if (clickAttempted) {
    activateElement(checkbox);
  }

  checkbox.checked = checked;
  checkbox.setAttribute("aria-checked", checked ? "true" : "false");

  return {
    label,
    beforeSelected,
    clickAttempted,
    afterSelected: checkbox.checked || checkbox.getAttribute("aria-checked") === "true"
  };
}

async function setSlicerOption(
  option: HTMLElement,
  selected: boolean,
  timing: PowerBiTiming,
  deadline: number,
  findLiveOption: (label: string) => HTMLElement | null = () => null
): Promise<SelectionTransition> {
  const label = labelForSlicerOption(option);
  const liveOption =
    findLiveOption(label) ??
    (option.isConnected && !isElementExplicitlyHidden(option) ? option : null);
  const beforeSelected = isSlicerOptionSelected(liveOption ?? option);
  const clickAttempted = liveOption !== null && beforeSelected !== selected && timing.now() < deadline;

  if (clickAttempted && liveOption) {
    activateElement(liveOption);
  }

  const verifyDeadline = Math.min(deadline, timing.now() + SLICER_SELECTION_VERIFY_TIMEOUT_MS);
  let updatedLiveOption =
    findLiveOption(label) ??
    (liveOption?.isConnected && !isElementExplicitlyHidden(liveOption) ? liveOption : null);
  while (
    clickAttempted &&
    updatedLiveOption &&
    isSlicerOptionSelected(updatedLiveOption) !== selected &&
    timing.now() < verifyDeadline
  ) {
    const remainingMs = verifyDeadline - timing.now();
    await timing.delay(Math.min(DROPDOWN_OPTIONS_INTERVAL_MS, remainingMs));
    updatedLiveOption =
      findLiveOption(label) ??
      (liveOption?.isConnected && !isElementExplicitlyHidden(liveOption) ? liveOption : null);
  }
  const afterSelected = updatedLiveOption ? isSlicerOptionSelected(updatedLiveOption) : beforeSelected;

  return {
    label,
    beforeSelected,
    clickAttempted,
    afterSelected
  };
}

async function applySlicerOptionsSelection(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  selectedLabels: string[],
  timing: PowerBiTiming,
  options: {
    deadline: number;
    onOpened?: (combobox: HTMLElement) => void;
    onResolvedExternalOptions?: (optionCount: number) => void;
    onWaitingForExternalOptions?: (timeoutMs: number, intervalMs: number) => void;
  }
): Promise<SlicerApplyResult> {
  const desiredLabels = new Set(selectedLabels);
  const availableLabels: string[] = [];
  const failedLabels: string[] = [];
  const seenLabels = new Set<string>();
  const initialOptions = await resolveSlicerOptions(root, control, timing, {
    ...options,
    clearSearchBeforeResolve: true
  });

  const discoveryCompleted = await scanSlicerOptions(
    root,
    control,
    title,
    initialOptions,
    (currentOptions, observation) => {
      if (observation.reset) {
        seenLabels.clear();
        availableLabels.length = 0;
      }
      for (const option of currentOptions) {
        const label = labelForSlicerOption(option);
        if (label.length === 0 || label === "Select all" || seenLabels.has(label)) {
          continue;
        }

        seenLabels.add(label);
        availableLabels.push(label);
      }
    },
    { timing, deadline: options.deadline, visibleOnly: true }
  );

  const preflightMissingLabels = selectedLabels.filter((label) => !seenLabels.has(label));

  console.debug(LOG_PREFIX, "Applying list filter selection", {
    title,
    controlKind: control.kind,
    desiredLabels: selectedLabels,
    availableLabels
  });

  if (!discoveryCompleted) {
    return { availableLabels, failedLabels: [], missingLabels: [], scanCompleted: false };
  }

  if (preflightMissingLabels.length > 0) {
    return { availableLabels, failedLabels, missingLabels: preflightMissingLabels, scanCompleted: true };
  }

  const appliedLabels = new Set<string>();
  const mutationSeenLabels = new Set<string>();
  let mutationEpochReset = false;
  const applyCompleted = await scanSlicerOptions(root, control, title, initialOptions, async (currentOptions, observation) => {
    if (observation.reset) {
      mutationEpochReset = true;
      appliedLabels.clear();
      failedLabels.length = 0;
      mutationSeenLabels.clear();
      seenLabels.clear();
      availableLabels.length = 0;
    }
    for (const option of currentOptions) {
      if (timing.now() >= options.deadline) {
        break;
      }
      const label = labelForSlicerOption(option);
      if (label.length === 0 || label === "Select all") {
        continue;
      }

      mutationSeenLabels.add(label);
      if (!seenLabels.has(label)) {
        seenLabels.add(label);
        availableLabels.push(label);
      }
      if (mutationEpochReset) {
        continue;
      }

      const selected = desiredLabels.has(label);
      if (appliedLabels.has(label) && isSlicerOptionSelected(option) === selected) {
        continue;
      }
      const transition = await setSlicerOption(option, selected, timing, options.deadline, (currentLabel) =>
        liveSlicerOptionByLabel(root, control, title, currentLabel, { visibleOnly: true })
      );
      logSelectionTransition(
        selected ? "Selecting filter value" : "Clearing filter value",
        title,
        control.kind,
        transition,
        selected
      );
      if (transition.afterSelected !== selected) {
        if (!failedLabels.includes(label)) {
          failedLabels.push(label);
        }
      } else {
        const failedIndex = failedLabels.indexOf(label);
        if (failedIndex >= 0) {
          failedLabels.splice(failedIndex, 1);
        }
      }
      appliedLabels.add(label);
    }
  }, { timing, deadline: options.deadline, visibleOnly: true });

  const mutationMissingLabels = selectedLabels.filter((label) => !mutationSeenLabels.has(label));
  return {
    availableLabels,
    failedLabels,
    missingLabels: mutationMissingLabels,
    scanCompleted: applyCompleted && !mutationEpochReset
  };
}

function slicerOptionIdentity(option: HTMLElement): string {
  const rowId = option.getAttribute("data-row-id")?.trim();
  if (rowId) {
    return `row:${rowId}`;
  }

  for (const attribute of ["data-key", "data-value", "data-identity"] as const) {
    const value = option.getAttribute(attribute)?.trim();
    if (value) {
      return `${attribute}:${value}`;
    }
  }

  const label = labelForSlicerOption(option).normalize("NFKC").replace(/\s+/g, " ").trim();
  if (label) {
    return `label:${label}`;
  }

  return "";
}

function liveSlicerOptionByIdentity(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  identity: string
): HTMLElement | null {
  for (const listbox of liveSlicerListboxes(root, control, title, { visibleOnly: true })) {
    const option = optionsInListbox(listbox).find(
      (candidate) => !isElementExplicitlyHidden(candidate) && slicerOptionIdentity(candidate) === identity
    );
    if (option) {
      return option;
    }
  }
  return null;
}

async function applyUniformSlicerSelection(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  selected: boolean,
  timing: PowerBiTiming,
  options: {
    deadline: number;
    onOpened?: (combobox: HTMLElement) => void;
  }
): Promise<SlicerApplyResult> {
  const initialOptions = await resolveSlicerOptions(root, control, timing, {
    ...options,
    clearSearchBeforeResolve: true
  });
  const availableLabels: string[] = [];
  const failedLabels: string[] = [];
  const discoveredIdentities = new Set<string>();
  const discoveryCompleted = await scanSlicerOptions(
    root,
    control,
    title,
    initialOptions,
    (currentOptions, observation) => {
      if (observation.reset) {
        discoveredIdentities.clear();
        availableLabels.length = 0;
      }
      for (const option of currentOptions) {
        const identity = slicerOptionIdentity(option);
        if (identity.length === 0 || discoveredIdentities.has(identity)) {
          continue;
        }
        discoveredIdentities.add(identity);
        availableLabels.push(labelForSlicerOption(option) || identity);
      }
    },
    { timing, deadline: options.deadline, visibleOnly: true }
  );

  if (!discoveryCompleted || discoveredIdentities.size === 0) {
    return { availableLabels, failedLabels: [], missingLabels: [], scanCompleted: false };
  }

  const appliedIdentities = new Set<string>();
  let mutationEpochReset = false;
  const applyCompleted = await scanSlicerOptions(
    root,
    control,
    title,
    initialOptions,
    async (currentOptions, observation) => {
      if (observation.reset) {
        mutationEpochReset = true;
        appliedIdentities.clear();
        failedLabels.length = 0;
        discoveredIdentities.clear();
        availableLabels.length = 0;
      }
      for (const option of currentOptions) {
        if (timing.now() >= options.deadline) {
          break;
        }
        const identity = slicerOptionIdentity(option);
        if (identity.length === 0) {
          continue;
        }
        const label = labelForSlicerOption(option) || identity;
        if (!discoveredIdentities.has(identity)) {
          discoveredIdentities.add(identity);
          availableLabels.push(label);
        }
        if (mutationEpochReset) {
          continue;
        }
        if (appliedIdentities.has(identity) && isSlicerOptionSelected(option) === selected) {
          continue;
        }
        const transition = await setSlicerOption(option, selected, timing, options.deadline, () =>
          liveSlicerOptionByIdentity(root, control, title, identity)
        );
        logSelectionTransition(
          selected ? "Selecting filter value" : "Clearing filter value",
          title,
          control.kind,
          transition,
          selected
        );
        if (transition.afterSelected !== selected) {
          if (!failedLabels.includes(label)) {
            failedLabels.push(label);
          }
        } else {
          const failedIndex = failedLabels.indexOf(label);
          if (failedIndex >= 0) {
            failedLabels.splice(failedIndex, 1);
          }
        }
        appliedIdentities.add(identity);
      }
    },
    { timing, deadline: options.deadline, visibleOnly: true }
  );

  if (!applyCompleted || mutationEpochReset) {
    return { availableLabels, failedLabels, missingLabels: [], scanCompleted: false };
  }
  if (appliedIdentities.size === 0) {
    return { availableLabels, failedLabels, missingLabels: [], scanCompleted: false };
  }

  const verificationFailures = new Set<string>();
  const verifiedIdentities = new Set<string>();
  const verifyCompleted = await scanSlicerOptions(
    root,
    control,
    title,
    initialOptions,
    (currentOptions, observation) => {
      if (observation.reset) {
        verifiedIdentities.clear();
        verificationFailures.clear();
      }
      for (const option of currentOptions) {
        verifiedIdentities.add(slicerOptionIdentity(option));
        if (isSlicerOptionSelected(option) !== selected) {
          verificationFailures.add(labelForSlicerOption(option) || slicerOptionIdentity(option));
        }
      }
    },
    { timing, deadline: options.deadline, visibleOnly: true }
  );

  return {
    availableLabels,
    failedLabels: Array.from(verificationFailures),
    missingLabels: [],
    scanCompleted:
      verifyCompleted &&
      verifiedIdentities.size > 0 &&
      Array.from(appliedIdentities).every((identity) => verifiedIdentities.has(identity))
  };
}

async function selectedSelectionForControl(
  root: ParentNode,
  control: ListControl,
  timing: PowerBiTiming
): Promise<CapturedSelection> {
  if (control.kind === "checkbox") {
    return {
      selectedLabels: Array.from(control.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .filter((checkbox) => checkbox.checked || checkbox.getAttribute("aria-checked") === "true")
        .map(labelForCheckbox)
        .filter(Boolean)
    };
  }

  const deadline = timing.now() + CAPTURE_DROPDOWN_OPTIONS_TIMEOUT_MS;
  let openedCombobox: HTMLElement | null = null;
  let observedSearchQuery: string | undefined;
  let searchQueryObserved = false;
  let searchStateInvalidatesMode = false;
  const observeSearchState = (listbox: HTMLElement): void => {
    const searchInput = listbox
      .closest<HTMLElement>(".slicerContainer")
      ?.querySelector<HTMLInputElement>(".searchHeader.show input.searchInput");
    if (!searchInput) {
      return;
    }

    const query = searchInput.value.trim();
    if (query.length > 0 || (searchQueryObserved && query !== observedSearchQuery)) {
      searchStateInvalidatesMode = true;
    }
    observedSearchQuery = query;
    searchQueryObserved = true;
  };

  try {
    const readSelection = async (forceOpenDropdown = false): Promise<CapturedSelection> => {
      const options = await resolveSlicerOptions(root, control, timing, {
        deadline,
        forceOpenDropdown,
        onOpened: (combobox) => {
          openedCombobox = combobox;
        }
      });
      const selectionByLabel = new Map<string, boolean>();
      let multiSelectObserved = false;
      const observeOptions = (
        currentOptions: HTMLElement[],
        observation?: SlicerScanObservation
      ): void => {
        if (observation?.reset) {
          selectionByLabel.clear();
          multiSelectObserved = false;
        }
        const listbox = currentOptions[0]?.closest<HTMLElement>('[role="listbox"]');
        multiSelectObserved ||= Boolean(listbox && isMultiSelectSlicerListbox(listbox));
        if (listbox) {
          observeSearchState(listbox);
        }
        for (const option of currentOptions) {
          const label = labelForSlicerOption(option);
          if (label.length > 0) {
            selectionByLabel.set(label, isSlicerOptionSelected(option));
          }
        }
      };
      observeOptions(options);

      const scanCompleted = await scanSlicerOptions(
        root,
        control,
        control.title,
        options,
        observeOptions,
        { timing, deadline }
      );
      liveSlicerListboxes(root, control, control.title).forEach(observeSearchState);
      const selectionStates = Array.from(selectionByLabel.values());

      if (!scanCompleted && multiSelectObserved) {
        return { selectedLabels: [], scanIncomplete: true };
      }

      if (
        !searchStateInvalidatesMode &&
        multiSelectObserved &&
        selectionStates.length > 0 &&
        selectionStates.every(Boolean)
      ) {
        return { selectedLabels: [], selectionMode: "all" };
      }
      if (
        !searchStateInvalidatesMode &&
        multiSelectObserved &&
        selectionStates.length > 0 &&
        selectionStates.every((selected) => !selected)
      ) {
        return { selectedLabels: [], selectionMode: "none" };
      }

      return {
        selectedLabels: Array.from(selectionByLabel.entries())
          .filter(([, selected]) => selected)
          .map(([label]) => label)
      };
    };

    const selection = await readSelection();
    if (selection.scanIncomplete) {
      return selection;
    }
    if (selection.selectionMode || selection.selectedLabels.length > 0) {
      return selection;
    }

    if (hasGenericMultiSelectSummary(control) && timing.now() < deadline) {
      const reopenedSelection = await readSelection(true);
      if (reopenedSelection.scanIncomplete) {
        return reopenedSelection;
      }
      if (reopenedSelection.selectionMode || reopenedSelection.selectedLabels.length > 0) {
        return reopenedSelection;
      }
    }

    const summaryLabels = selectedLabelsFromComboboxSummary(control);
    return { selectedLabels: summaryLabels };
  } finally {
    if (openedCombobox) {
      await closeSlicerDropdown(openedCombobox, timing);
    }
  }
}

function initiallyMaterializedSlicerSelections(root: ParentNode, controls: ListControl[]): Map<string, string[]> {
  const selectionsByTitle = new Map<string, string[]>();

  for (const control of controls) {
    if (control.kind !== "slicer") {
      continue;
    }

    const labels = selectedLabelsFromSlicerOptions(
      liveSlicerListboxes(root, control, control.title).flatMap((listbox) => optionsInListbox(listbox))
    );
    if (labels.length === 0) {
      continue;
    }

    const existingLabels = selectionsByTitle.get(control.title) ?? [];
    selectionsByTitle.set(control.title, Array.from(new Set([...existingLabels, ...labels])));
  }

  return selectionsByTitle;
}

function isSlicerAlreadyClear(root: ParentNode, control: SlicerControl): boolean {
  if (!hasAllComboboxSummary(control)) {
    return false;
  }

  const materializedOptions = liveSlicerListboxes(root, control, control.title, { visibleOnly: true }).flatMap(
    (listbox) => optionsInListbox(listbox).filter((option) => !isElementExplicitlyHidden(option))
  );

  return selectedLabelsFromSlicerOptions(materializedOptions).length === 0;
}

export function createPowerBiDomAdapter(root: ParentNode = document, options: PowerBiDomAdapterOptions = {}): PowerBiDomAdapter {
  const timing = options.timing ?? defaultPowerBiTiming;
  return {
    async waitForFilterControls(options = {}) {
      const timeoutMs = options.timeoutMs ?? FILTER_CONTROL_READINESS_TIMEOUT_MS;
      const intervalMs = options.intervalMs ?? 250;
      const deadline = timing.now() + timeoutMs;

      while (timing.now() <= deadline) {
        if (listFilterControls(root).length > 0) {
          return true;
        }
        await timing.delay(intervalMs);
      }

      return false;
    },

    async readListFilters() {
      const filters: FilterPresetItem[] = [];
      const controls = listFilterControls(root);
      const initialSlicerSelections = initiallyMaterializedSlicerSelections(root, controls);

      for (const control of controls) {
        const capturedSelection = await selectedSelectionForControl(root, control, timing);
        if (capturedSelection.scanIncomplete) {
          continue;
        }
        const selectedLabels =
          control.kind === "slicer" &&
          capturedSelection.selectionMode === undefined &&
          capturedSelection.selectedLabels.length === 0
            ? initialSlicerSelections.get(control.title) ?? capturedSelection.selectedLabels
            : capturedSelection.selectedLabels;

        filters.push({
          title: control.title,
          type: "list" as const,
          selectedLabels,
          ...(capturedSelection.selectionMode ? { selectionMode: capturedSelection.selectionMode } : {})
        });
      }

      return filters;
    },

    async applyListFilterSelection(title: string, selectedLabels: string[], selectionMode) {
      const deadline = timing.now() + APPLY_FILTER_TIMEOUT_MS;
      const desiredLabels = selectionMode ? [] : selectedLabels;
      const controls = matchingControls(root, title);

      if (controls.length === 0) {
        console.warn(LOG_PREFIX, "Filter was not found while applying preset", { title, desiredLabels });
        return missingFilterApplyResult(title);
      }

      if (controls.length > 1) {
        console.warn(LOG_PREFIX, "More than one filter matched while applying preset", {
          title,
          desiredLabels,
          matchCount: controls.length
        });
        return ambiguousFilterApplyResult(title);
      }

      const control = controls[0];
      let openedCombobox: HTMLElement | null = null;

      try {
        if (selectionMode && control.kind !== "slicer") {
          return missingValuesApplyResult(title, [selectionMode]);
        }

        if (control.kind === "slicer") {
          if (selectionMode) {
            const modeResult = await applyUniformSlicerSelection(
              root,
              control,
              title,
              selectionMode === "all",
              timing,
              {
                deadline,
                onOpened: (combobox) => {
                  openedCombobox = combobox;
                }
              }
            );
            return resolveSlicerApplyResult({
              ...modeResult,
              logPrefix: LOG_PREFIX,
              title,
              desiredLabels: []
            });
          }

          if (desiredLabels.length === 0 && isSlicerAlreadyClear(root, control)) {
            console.debug(LOG_PREFIX, "Applying list filter selection", {
              title,
              controlKind: control.kind,
              desiredLabels,
              availableLabels: []
            });
            return appliedFilterResult(title, 0);
          }

          const result = await applySlicerOptionsSelection(root, control, title, desiredLabels, timing, {
            deadline,
            onOpened: (combobox) => {
              openedCombobox = combobox;
              console.info(LOG_PREFIX, "Opened dropdown", {
                title,
                ariaLabel: combobox.getAttribute("aria-label")?.trim() || ""
              });
            },
            onResolvedExternalOptions: (optionCount) => {
              console.info(LOG_PREFIX, "Resolved dropdown options", { title, optionCount });
            },
            onWaitingForExternalOptions: (timeoutMs, intervalMs) => {
              console.info(LOG_PREFIX, "Waiting for dropdown options", { title, timeoutMs, intervalMs });
            }
          });

          return resolveSlicerApplyResult({
            ...result,
            logPrefix: LOG_PREFIX,
            title,
            desiredLabels
          });
        }

        const entries = Array.from(control.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map(
          (checkbox) => [labelForCheckbox(checkbox), checkbox] as const
        );
        const byLabel = new Map(entries.filter(([label]) => label.length > 0 && label !== "Select all"));
        const availableLabels = Array.from(byLabel.keys());
        const missing = desiredLabels.filter((label) => !byLabel.has(label));

        console.debug(LOG_PREFIX, "Applying list filter selection", {
          title,
          controlKind: control.kind,
          desiredLabels,
          availableLabels
        });

        if (missing.length > 0) {
          console.warn(LOG_PREFIX, "Missing filter values while applying preset", {
            title,
            desiredLabels,
            missingLabels: missing,
            availableLabels
          });
          return missingValuesApplyResult(title, missing);
        }

        for (const [label, element] of byLabel) {
          const transition = setCheckbox(element, false);
          logSelectionTransition("Clearing filter value", title, control.kind, { ...transition, label }, false);
        }

        for (const label of desiredLabels) {
          const element = byLabel.get(label);
          if (element) {
            logSelectionTransition(
              "Selecting filter value",
              title,
              control.kind,
              { ...setCheckbox(element, true), label },
              true
            );
          }
        }

        return appliedFilterResult(title, desiredLabels.length);
      } finally {
        if (openedCombobox) {
          await closeSlicerDropdown(openedCombobox, timing, { title });
        }
      }
    }
  };
}
