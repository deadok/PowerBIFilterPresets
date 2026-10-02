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
  externalSlicerListboxes,
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
import { authoritativeSlicerLogicalRow } from "./powerBiLogicalRows";
import { scrollElementForListbox } from "./powerBiScrollStrategies";
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
  searchWasActive?: boolean;
};

type InitialSlicerSearchState = {
  projectionEvidence: SlicerProjectionEvidence;
  query: string;
};

type SlicerProjectionEvidence = {
  clientHeight: number;
  loaderVisible: boolean;
  projectionSignature: string;
  logicalDomainSize: number | null;
  scrollHeight: number;
  scrollTop: number;
};

// One absolute per-slicer deadline shared by capture resolve, optional reopen, and scanning.
const CAPTURE_DROPDOWN_OPTIONS_TIMEOUT_MS = 9000;
const FILTER_CONTROL_READINESS_TIMEOUT_MS = 8000;
// One absolute per-filter deadline shared by resolve, discovery, mutation, verification, and fallbacks.
const APPLY_FILTER_TIMEOUT_MS = 9000;
const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
const SLICER_SEARCH_RESTORE_STABLE_MS = 50;
const SLICER_SEARCH_RESTORE_MAX_ATTEMPTS = 2;
// Power BI debounces its keyup-driven search without showing a loader. Leave
// room for that response plus the render stability check inside the same cap.
const SLICER_SEARCH_RESTORE_BUDGET_MS = 700;
const SLICER_SELECTION_VERIFY_TIMEOUT_MS = 250;
const LOG_PREFIX = "[Power BI Presets]";

function isAuthoritativeSelectedSingleton(options: HTMLElement[]): boolean {
  if (options.length !== 1) {
    return false;
  }

  const option = options[0];
  const listbox = option.closest<HTMLElement>('[role="listbox"]');
  const logicalRow = authoritativeSlicerLogicalRow(option);

  return Boolean(
    listbox &&
    !isElementExplicitlyHidden(option) &&
    !isElementExplicitlyHidden(listbox) &&
    isMultiSelectSlicerListbox(listbox) &&
    labelForSlicerOption(option).length > 0 &&
    isSlicerOptionSelected(option) &&
    logicalRow?.expectedSize === 1 &&
    logicalRow.position === 1
  );
}

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
    deadline?: number | (() => number);
    dropdownOptionsIntervalMs?: number;
    acceptAuthoritativeSelectedSingleton?: () => boolean;
    captureVisibleOptionsOnly?: () => boolean;
    clearSearchBeforeResolve?: boolean;
    forceOpenDropdown?: boolean;
    onOpened?: (combobox: HTMLElement) => void;
    onResolvedExternalOptions?: (optionCount: number) => void;
    onWaitingForExternalOptions?: (timeoutMs: number, intervalMs: number) => void;
    prepareCaptureSearch?: () => void;
  }
): Promise<HTMLElement[]> {
  const inlineOptions = slicerOptions(control).filter(
    (option) => !(options.clearSearchBeforeResolve || options.captureVisibleOptionsOnly?.()) ||
      !isElementExplicitlyHidden(option)
  );
  if (!options.forceOpenDropdown && inlineOptions.length > 0) {
    return inlineOptions;
  }

  const dropdownDocument = control.element.ownerDocument;
  const dropdownRoots = [root, dropdownDocument];
  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  const externalOptionsForResolve = () => {
    options.prepareCaptureSearch?.();
    const resolvedOptions = externalSlicerOptions(dropdownRoots, control.title, combobox);
    return options.clearSearchBeforeResolve || options.captureVisibleOptionsOnly?.()
      ? resolvedOptions.filter((option) => !isElementExplicitlyHidden(option))
      : resolvedOptions;
  };
  const externalOptionsAreReady = (externalOptions: HTMLElement[]) =>
    (hasSlicerValueOption(externalOptions) ||
      Boolean(
        options.acceptAuthoritativeSelectedSingleton?.() &&
        isAuthoritativeSelectedSingleton(externalOptions)
      ));
  if (options.clearSearchBeforeResolve) {
    clearControlledSlicerSearch(control);
  }
  const existingExternalOptions = externalOptionsForResolve();
  if (
    !options.forceOpenDropdown &&
    existingExternalOptions.length > 0 &&
    externalOptionsAreReady(existingExternalOptions)
  ) {
    return existingExternalOptions;
  }

  if (!combobox) {
    return [];
  }

  const existingExternalListbox = options.clearSearchBeforeResolve || options.prepareCaptureSearch
    ? controlledSlicerListbox(control, { visibleOnly: true })
    : existingExternalOptions[0]?.closest<HTMLElement>('[role="listbox"]');
  const canReuseOpenPopup =
    (options.clearSearchBeforeResolve || options.prepareCaptureSearch) &&
    !options.forceOpenDropdown && existingExternalListbox?.isConnected;
  if (!canReuseOpenPopup) {
    activateElement(combobox, { preferMouseEvents: true });
    options.onOpened?.(combobox);
  }
  if (options.clearSearchBeforeResolve) {
    clearControlledSlicerSearch(control);
  }
  const intervalMs = options.dropdownOptionsIntervalMs ?? DROPDOWN_OPTIONS_INTERVAL_MS;
  const fallbackDeadline = timing.now() + CAPTURE_DROPDOWN_OPTIONS_TIMEOUT_MS;
  const resolveDeadline = () => typeof options.deadline === "function"
    ? options.deadline()
    : options.deadline ?? fallbackDeadline;
  let externalOptions = externalOptionsForResolve();
  options.onWaitingForExternalOptions?.(Math.max(0, resolveDeadline() - timing.now()), intervalMs);

  while (!externalOptionsAreReady(externalOptions) && timing.now() < resolveDeadline()) {
    const remainingMs = resolveDeadline() - timing.now();
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

function setControlledSlicerSearch(control: SlicerControl, value: string): boolean {
  const input = controlledSlicerSearchInput(control);
  if (!input || input.value === value) {
    return false;
  }

  const InputConstructor = input.ownerDocument.defaultView?.HTMLInputElement;
  const nativeValueSetter = InputConstructor
    ? Object.getOwnPropertyDescriptor(InputConstructor.prototype, "value")?.set
    : undefined;
  if (nativeValueSetter) {
    nativeValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  const InputEventConstructor = input.ownerDocument.defaultView?.InputEvent;
  input.dispatchEvent(
    typeof InputEventConstructor === "function"
      ? new InputEventConstructor("input", {
          bubbles: true,
          cancelable: false,
          data: value.length > 0 ? value : null,
          inputType: value.length > 0 ? "insertText" : "deleteContentBackward"
        })
      : new Event("input", { bubbles: true })
  );
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const KeyboardEventConstructor = input.ownerDocument.defaultView?.KeyboardEvent;
  if (KeyboardEventConstructor) {
    const key = value.length > 0 ? value.slice(-1) : "Backspace";
    input.dispatchEvent(new KeyboardEventConstructor("keyup", {
      bubbles: true,
      key,
      code: value.length > 0 ? "" : "Backspace",
      keyCode: value.length > 0 ? value.toUpperCase().charCodeAt(value.length - 1) : 8,
      which: value.length > 0 ? value.toUpperCase().charCodeAt(value.length - 1) : 8
    }));
  }
  return true;
}

function clearControlledSlicerSearch(control: SlicerControl): boolean {
  return setControlledSlicerSearch(control, "");
}

async function restoreControlledSlicerSearch(
  control: SlicerControl,
  value: string,
  timing: PowerBiTiming,
  deadline: number,
  initialEvidence: SlicerProjectionEvidence | null
): Promise<boolean> {
  const baselineListbox = controlledSlicerListbox(control, { visibleOnly: true });
  const baseline = baselineListbox
    ? slicerProjectionEvidence(optionsInListbox(baselineListbox), baselineListbox)
    : null;
  let attempt = 0;
  let stableSignature: string | null = null;
  let stableSince = timing.now();
  // Restore the user's input and notify the host even if a prior operation used
  // its entire deadline; only the bounded verification may then be unavailable.
  if (setControlledSlicerSearch(control, value)) {
    attempt += 1;
  }
  while (timing.now() < deadline) {
    const input = controlledSlicerSearchInput(control);
    if (input && input.value !== value && attempt < SLICER_SEARCH_RESTORE_MAX_ATTEMPTS) {
      setControlledSlicerSearch(control, value);
      attempt += 1;
      stableSignature = null;
    }
    const settledInput = controlledSlicerSearchInput(control);
    const listbox = controlledSlicerListbox(control, { visibleOnly: true });
    const evidence = listbox ? slicerProjectionEvidence(optionsInListbox(listbox), listbox) : null;
    const projectionResponded = evidence && initialEvidence && (
      evidence.projectionSignature === initialEvidence.projectionSignature ||
      (initialEvidence.scrollTop > 0 && baseline &&
        initialEvidence.logicalDomainSize !== null &&
        evidence.logicalDomainSize === initialEvidence.logicalDomainSize &&
        evidence.scrollHeight === initialEvidence.scrollHeight &&
        evidence.projectionSignature !== baseline.projectionSignature)
    );
    if (settledInput?.value === value && evidence && !evidence.loaderVisible && projectionResponded) {
      const signature = JSON.stringify([
        evidence.projectionSignature, evidence.scrollHeight, evidence.clientHeight
      ]);
      if (signature !== stableSignature) {
        stableSignature = signature;
        stableSince = timing.now();
      } else if (timing.now() - stableSince >= SLICER_SEARCH_RESTORE_STABLE_MS) {
        return true;
      }
    } else {
      stableSignature = null;
    }
    await timing.delay(Math.min(DROPDOWN_OPTIONS_INTERVAL_MS, deadline - timing.now()));
  }

  return false;
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

function slicerProjectionSignature(options: HTMLElement[]): string {
  const visibleOptions = options.filter((option) => !isElementExplicitlyHidden(option));
  const labels = visibleOptions
    .map((option) => labelForSlicerOption(option).normalize("NFKC").replace(/\s+/g, " ").trim())
    .sort();
  const logicalRows = visibleOptions
    .map(authoritativeSlicerLogicalRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const expectedSizes = logicalRows.map((row) => row.expectedSize).sort((left, right) => left - right);
  const positions = logicalRows.map((row) => row.position).sort((left, right) => left - right);

  return JSON.stringify({ labels, expectedSizes, positions });
}

function slicerProjectionEvidence(
  options: HTMLElement[],
  listbox = options[0]?.closest<HTMLElement>('[role="listbox"]')
): SlicerProjectionEvidence | null {
  if (!listbox) {
    return null;
  }
  const scrollElement = scrollElementForListbox(listbox);
  const loader =
    listbox.closest<HTMLElement>(".slicer-dropdown-popup")?.querySelector<HTMLElement>(".slicer-dropdown-loader") ??
    listbox.closest<HTMLElement>(".slicerContainer")?.querySelector<HTMLElement>(".slicer-dropdown-loader") ??
    null;
  const domainSizes = new Set(options
    .map(authoritativeSlicerLogicalRow)
    .flatMap((row) => row ? [row.expectedSize] : []));

  return {
    clientHeight: scrollElement.clientHeight,
    loaderVisible: Boolean(loader && !isElementExplicitlyHidden(loader)),
    projectionSignature: slicerProjectionSignature(options),
    logicalDomainSize: domainSizes.size === 1 ? [...domainSizes][0] : null,
    scrollHeight: scrollElement.scrollHeight,
    scrollTop: scrollElement.scrollTop
  };
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
  timing: PowerBiTiming,
  initialSearchState?: InitialSlicerSearchState
): Promise<CapturedSelection> {
  if (control.kind === "checkbox") {
    return {
      selectedLabels: Array.from(control.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        .filter((checkbox) => checkbox.checked || checkbox.getAttribute("aria-checked") === "true")
        .map(labelForCheckbox)
        .filter(Boolean)
    };
  }

  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  const hasControlledPopup = Boolean(combobox?.getAttribute("aria-controls")?.trim());
  const uncontrolledExternalListboxes = hasControlledPopup
    ? []
    : externalSlicerListboxes([root, control.element.ownerDocument], control.title, combobox);
  if (
    uncontrolledExternalListboxes.length > 1 ||
    uncontrolledExternalListboxes.some((listbox) => {
      if (isElementExplicitlyHidden(listbox)) {
        return false;
      }
      const searchInput = listbox
        .closest<HTMLElement>(".slicerContainer")
        ?.querySelector<HTMLInputElement>(".searchHeader.show input.searchInput");
      return Boolean(searchInput?.value.trim());
    })
  ) {
    return { selectedLabels: [], scanIncomplete: true };
  }

  const deadline = timing.now() + CAPTURE_DROPDOWN_OPTIONS_TIMEOUT_MS;
  let openedCombobox: HTMLElement | null = null;
  let originalSearchQuery: string | null = initialSearchState?.query ?? null;
  let initialProjectionEvidence = initialSearchState?.projectionEvidence ?? null;
  let searchQueryConflict = false;
  let searchWasActive = initialSearchState !== undefined;
  let unfilteredDomainTransitionObserved = false;
  let unfilteredDomainTransitionInvalidated = false;
  let scanTraversalStarted = false;
  let clearTriggeredLoader = false;
  const prepareCaptureSearch = (): void => {
    const input = controlledSlicerSearchInput(control);
    if (!input || input.value.trim().length === 0) {
      return;
    }

    if (originalSearchQuery === null) {
      originalSearchQuery = input.value;
      const listbox = controlledSlicerListbox(control, { visibleOnly: true });
      if (listbox) {
        initialProjectionEvidence = slicerProjectionEvidence(optionsInListbox(listbox), listbox);
      }
    } else if (input.value !== originalSearchQuery) {
      searchQueryConflict = true;
    }
    searchWasActive = true;
    clearControlledSlicerSearch(control);
  };

  const captureSelection = async (): Promise<CapturedSelection> => {
    const readSelection = async (forceOpenDropdown = false): Promise<CapturedSelection> => {
      prepareCaptureSearch();
      const workDeadlineForSearch = () => searchWasActive
        ? deadline - SLICER_SEARCH_RESTORE_BUDGET_MS
        : deadline;
      const observesUnfilteredDomainTransition = (currentOptions: HTMLElement[]): boolean => {
        if (!searchWasActive) {
          return true;
        }
        if (unfilteredDomainTransitionInvalidated) {
          return false;
        }
        const currentEvidence = slicerProjectionEvidence(currentOptions);
        if (!currentEvidence || !initialProjectionEvidence) {
          return false;
        }
        clearTriggeredLoader ||=
          !initialProjectionEvidence.loaderVisible && currentEvidence.loaderVisible;
        if (scanTraversalStarted || currentEvidence.loaderVisible) {
          return unfilteredDomainTransitionObserved;
        }
        const initialScrollableExtent = Math.max(
          0,
          initialProjectionEvidence.scrollHeight - initialProjectionEvidence.clientHeight
        );
        const currentScrollableExtent = Math.max(
          0,
          currentEvidence.scrollHeight - currentEvidence.clientHeight
        );
        const semanticOrLogicalDomainChanged =
          currentEvidence.projectionSignature !== initialProjectionEvidence.projectionSignature;
        const scrollGeometryExpanded = currentScrollableExtent > initialScrollableExtent;
        const authoritativeDomainExpanded =
          currentEvidence.logicalDomainSize !== null &&
          initialProjectionEvidence.logicalDomainSize !== null &&
          currentEvidence.logicalDomainSize > initialProjectionEvidence.logicalDomainSize;
        // Clearing the host search may itself reset a scrolled viewport. Only
        // independent size/extent expansion can explain that reset; labels
        // revealed by moving through the same projection are not clear proof.
        if (
          currentEvidence.scrollTop !== initialProjectionEvidence.scrollTop &&
          !authoritativeDomainExpanded && !scrollGeometryExpanded
        ) {
          return unfilteredDomainTransitionObserved;
        }
        const loaderLifecycleAllowsProof = !clearTriggeredLoader || !currentEvidence.loaderVisible;
        if ((semanticOrLogicalDomainChanged || scrollGeometryExpanded) && loaderLifecycleAllowsProof) {
          unfilteredDomainTransitionObserved = true;
        }
        return unfilteredDomainTransitionObserved;
      };
      const options = await resolveSlicerOptions(root, control, timing, {
        deadline: workDeadlineForSearch,
        forceOpenDropdown,
        acceptAuthoritativeSelectedSingleton: () => searchWasActive,
        captureVisibleOptionsOnly: () => true,
        prepareCaptureSearch,
        onOpened: (combobox) => {
          openedCombobox = combobox;
        }
      });
      const workDeadline = workDeadlineForSearch();
      const selectionByLabel = new Map<string, boolean>();
      let multiSelectObserved = false;
      let selectionStateConflict = false;
      const observeOptions = (
        currentOptions: HTMLElement[],
        observation?: SlicerScanObservation
      ): void => {
        if (observation?.reset) {
          selectionByLabel.clear();
          multiSelectObserved = false;
          if (searchWasActive) {
            const resetCrossedTrustedBoundary =
              unfilteredDomainTransitionObserved || scanTraversalStarted;
            unfilteredDomainTransitionObserved = false;
            clearTriggeredLoader = false;
            unfilteredDomainTransitionInvalidated ||= resetCrossedTrustedBoundary;
          }
        }
        const listbox = currentOptions[0]?.closest<HTMLElement>('[role="listbox"]');
        multiSelectObserved ||= Boolean(listbox && isMultiSelectSlicerListbox(listbox));
        const searchInput = listbox
          ?.closest<HTMLElement>(".slicerContainer")
          ?.querySelector<HTMLInputElement>(".searchHeader.show input.searchInput");
        if (searchInput?.value.trim()) {
          prepareCaptureSearch();
          return;
        }
        observesUnfilteredDomainTransition(currentOptions);
        for (const option of currentOptions) {
          const label = labelForSlicerOption(option);
          if (label.length > 0) {
            const selected = isSlicerOptionSelected(option);
            const previous = selectionByLabel.get(label);
            if (previous !== undefined && previous !== selected) {
              selectionStateConflict = true;
            }
            selectionByLabel.set(label, selected);
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
        {
          timing,
          deadline: workDeadline,
          visibleOnly: true,
          onTraversalStart: searchWasActive
            ? () => {
                scanTraversalStarted = true;
              }
            : undefined,
          canStartTraversal: searchWasActive
            ? () => unfilteredDomainTransitionObserved && !unfilteredDomainTransitionInvalidated
            : undefined
        }
      );
      const selectionStates = Array.from(selectionByLabel.values());

      if (
        searchQueryConflict ||
        selectionStateConflict ||
        unfilteredDomainTransitionInvalidated ||
        (searchWasActive && (!scanCompleted || !unfilteredDomainTransitionObserved)) ||
        (!scanCompleted && multiSelectObserved)
      ) {
        return { selectedLabels: [], scanIncomplete: true };
      }

      const selectedLabels = Array.from(selectionByLabel.entries())
        .filter(([, selected]) => selected)
        .map(([label]) => label);
      if (searchWasActive && hasGenericMultiSelectSummary(control) && selectedLabels.length < 2) {
        return { selectedLabels: [], scanIncomplete: true };
      }

      if (
        !searchWasActive &&
        multiSelectObserved &&
        selectionStates.length > 0 &&
        selectionStates.every(Boolean)
      ) {
        return { selectedLabels: [], selectionMode: "all" };
      }
      if (
        !searchWasActive &&
        multiSelectObserved &&
        selectionStates.length > 0 &&
        selectionStates.every((selected) => !selected)
      ) {
        return { selectedLabels: [], selectionMode: "none" };
      }

      return { selectedLabels };
    };

    const selection = await readSelection();
    if (selection.scanIncomplete) {
      return selection;
    }
    if (selection.selectionMode || selection.selectedLabels.length > 0) {
      return selection;
    }

    const reopenDeadline = searchWasActive
      ? deadline - SLICER_SEARCH_RESTORE_BUDGET_MS
      : deadline;
    if (hasGenericMultiSelectSummary(control) && timing.now() < reopenDeadline) {
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
  };

  let capturedSelection: CapturedSelection;
  let searchRestored = true;
  try {
    capturedSelection = await captureSelection();
  } finally {
    if (originalSearchQuery !== null) {
      searchRestored = await restoreControlledSlicerSearch(
        control,
        originalSearchQuery,
        timing,
        deadline,
        initialProjectionEvidence
      );
    }
    if (openedCombobox) {
      await closeSlicerDropdown(openedCombobox, timing);
    }
  }
  if (!searchRestored) {
    return { selectedLabels: [], scanIncomplete: true };
  }
  return searchWasActive ? { ...capturedSelection, searchWasActive: true } : capturedSelection;
}

function initiallyMaterializedSlicerSelections(
  root: ParentNode,
  controls: ListControl[]
): Map<SlicerControl, string[]> {
  const selectionsByControl = new Map<SlicerControl, string[]>();
  for (const control of controls) {
    if (control.kind !== "slicer") {
      continue;
    }
    const labels = selectedLabelsFromSlicerOptions(
      liveSlicerListboxes(root, control, control.title, { visibleOnly: true })
        .flatMap((listbox) => optionsInListbox(listbox))
    );
    if (labels.length > 0) {
      selectionsByControl.set(control, Array.from(new Set(labels)));
    }
  }
  return selectionsByControl;
}

function initiallyMaterializedSlicerSearchStates(
  controls: ListControl[]
): Map<SlicerControl, InitialSlicerSearchState> {
  const statesByControl = new Map<SlicerControl, InitialSlicerSearchState>();
  for (const control of controls) {
    if (control.kind !== "slicer") {
      continue;
    }
    const listbox = controlledSlicerListbox(control, { visibleOnly: true });
    const query = controlledSlicerSearchInput(control)?.value;
    const projectionEvidence = listbox ? slicerProjectionEvidence(optionsInListbox(listbox), listbox) : null;
    if (projectionEvidence && query?.trim()) {
      statesByControl.set(control, {
        projectionEvidence,
        query
      });
    }
  }
  return statesByControl;
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
      const initialSlicerSearchStates = initiallyMaterializedSlicerSearchStates(controls);
      const controlTitleCounts = new Map<string, number>();
      controls.forEach((control) => {
        controlTitleCounts.set(control.title, (controlTitleCounts.get(control.title) ?? 0) + 1);
      });

      for (const control of controls) {
        if ((controlTitleCounts.get(control.title) ?? 0) > 1) {
          continue;
        }
        const capturedSelection = await selectedSelectionForControl(
          root,
          control,
          timing,
          control.kind === "slicer" ? initialSlicerSearchStates.get(control) : undefined
        );
        if (capturedSelection.scanIncomplete) {
          console.warn(LOG_PREFIX, "Filter was omitted because complete capture could not be verified", {
            title: control.title,
            captureTimeoutMs: CAPTURE_DROPDOWN_OPTIONS_TIMEOUT_MS
          });
          continue;
        }

        const selectedLabels =
          control.kind === "slicer" &&
          !capturedSelection.searchWasActive &&
          capturedSelection.selectionMode === undefined &&
          capturedSelection.selectedLabels.length === 0
            ? initialSlicerSelections.get(control) ?? capturedSelection.selectedLabels
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
