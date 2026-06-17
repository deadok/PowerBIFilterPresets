import type { FilterOperationResult, FilterPresetItem } from "../shared/types";
import {
  externalSlicerOptions,
  hasAllComboboxSummary,
  hasGenericMultiSelectSummary,
  hasSlicerValueOption,
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
import { liveSlicerListboxes, liveSlicerOptionByLabel, scanSlicerOptions } from "./powerBiVirtualizedOptions";

type PowerBiDomAdapter = {
  waitForFilterControls(options?: { timeoutMs?: number; intervalMs?: number }): Promise<boolean>;
  readListFilters(): Promise<FilterPresetItem[]>;
  applyListFilterSelection(title: string, selectedLabels: string[]): Promise<FilterOperationResult>;
};

type SelectionTransition = {
  label: string;
  beforeSelected: boolean;
  clickAttempted: boolean;
  afterSelected: boolean;
};

type SlicerSelectionResult = {
  availableLabels: string[];
  failedLabels: string[];
  missingLabels: string[];
  scanCompleted: boolean;
};

const DROPDOWN_OPTIONS_TIMEOUT_MS = 1500;
const APPLY_DROPDOWN_OPTIONS_TIMEOUT_MS = 5000;
const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
const SLICER_SELECTION_VERIFY_TIMEOUT_MS = 250;
const LOG_PREFIX = "[Power BI Presets]";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function closeSlicerDropdown(combobox: HTMLElement, options: { title?: string } = {}): Promise<void> {
  return closeDropdownOpenedForRead(combobox, {
    delay,
    logPrefix: LOG_PREFIX,
    title: options.title
  });
}

async function resolveSlicerOptions(
  root: ParentNode,
  control: SlicerControl,
  options: {
    dropdownOptionsIntervalMs?: number;
    dropdownOptionsTimeoutMs?: number;
    forceOpenDropdown?: boolean;
    onOpened?: (combobox: HTMLElement) => void;
    onResolvedExternalOptions?: (optionCount: number) => void;
    onWaitingForExternalOptions?: (timeoutMs: number, intervalMs: number) => void;
  } = {}
): Promise<HTMLElement[]> {
  const inlineOptions = slicerOptions(control);
  if (!options.forceOpenDropdown && inlineOptions.length > 0) {
    return inlineOptions;
  }

  const dropdownDocument = control.element.ownerDocument;
  const dropdownRoots = [root, dropdownDocument];
  const existingExternalOptions = externalSlicerOptions(dropdownRoots, control.title);
  if (!options.forceOpenDropdown && existingExternalOptions.length > 0 && hasSlicerValueOption(existingExternalOptions)) {
    return existingExternalOptions;
  }

  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  if (!combobox) {
    return [];
  }

  activateElement(combobox, { preferMouseEvents: true });
  options.onOpened?.(combobox);
  const timeoutMs = options.dropdownOptionsTimeoutMs ?? DROPDOWN_OPTIONS_TIMEOUT_MS;
  const intervalMs = options.dropdownOptionsIntervalMs ?? DROPDOWN_OPTIONS_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let externalOptions = externalSlicerOptions(dropdownRoots, control.title);
  options.onWaitingForExternalOptions?.(timeoutMs, intervalMs);

  while (!hasSlicerValueOption(externalOptions) && Date.now() <= deadline) {
    await delay(intervalMs);
    externalOptions = externalSlicerOptions(dropdownRoots, control.title);
  }

  options.onResolvedExternalOptions?.(externalOptions.length);

  return externalOptions;
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
  findLiveOption: (label: string) => HTMLElement | null = () => null
): Promise<SelectionTransition> {
  const label = labelForSlicerOption(option);
  const liveOption = findLiveOption(label) ?? (option.isConnected ? option : null) ?? option;
  const beforeSelected = isSlicerOptionSelected(liveOption);
  const clickAttempted = beforeSelected !== selected;

  if (clickAttempted) {
    activateElement(liveOption);
  }

  const deadline = Date.now() + SLICER_SELECTION_VERIFY_TIMEOUT_MS;
  let updatedLiveOption = findLiveOption(label) ?? (liveOption.isConnected ? liveOption : null);
  while (
    clickAttempted &&
    updatedLiveOption &&
    isSlicerOptionSelected(updatedLiveOption) !== selected &&
    Date.now() <= deadline
  ) {
    await delay(DROPDOWN_OPTIONS_INTERVAL_MS);
    updatedLiveOption = findLiveOption(label) ?? (liveOption.isConnected ? liveOption : null);
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
  options: {
    dropdownOptionsTimeoutMs?: number;
    onOpened?: (combobox: HTMLElement) => void;
    onResolvedExternalOptions?: (optionCount: number) => void;
    onWaitingForExternalOptions?: (timeoutMs: number, intervalMs: number) => void;
  } = {}
): Promise<SlicerSelectionResult> {
  const desiredLabels = new Set(selectedLabels);
  const availableLabels: string[] = [];
  const failedLabels: string[] = [];
  const seenLabels = new Set<string>();
  const initialOptions = await resolveSlicerOptions(root, control, options);

  const discoveryCompleted = await scanSlicerOptions(root, control, title, initialOptions, (currentOptions) => {
    for (const option of currentOptions) {
      const label = labelForSlicerOption(option);
      if (label.length === 0 || label === "Select all" || seenLabels.has(label)) {
        continue;
      }

      seenLabels.add(label);
      availableLabels.push(label);
    }
  });

  const missingLabels = selectedLabels.filter((label) => !seenLabels.has(label));

  console.debug(LOG_PREFIX, "Applying list filter selection", {
    title,
    controlKind: control.kind,
    desiredLabels: selectedLabels,
    availableLabels
  });

  if (!discoveryCompleted) {
    return { availableLabels, failedLabels: [], missingLabels: [], scanCompleted: false };
  }

  if (missingLabels.length > 0) {
    return { availableLabels, failedLabels, missingLabels, scanCompleted: true };
  }

  const appliedLabels = new Set<string>();
  const applyCompleted = await scanSlicerOptions(root, control, title, initialOptions, async (currentOptions) => {
    for (const option of currentOptions) {
      const label = labelForSlicerOption(option);
      if (label.length === 0 || label === "Select all" || appliedLabels.has(label)) {
        continue;
      }

      const selected = desiredLabels.has(label);
      const transition = await setSlicerOption(option, selected, (currentLabel) =>
        liveSlicerOptionByLabel(root, control, title, currentLabel)
      );
      logSelectionTransition(
        selected ? "Selecting filter value" : "Clearing filter value",
        title,
        control.kind,
        transition,
        selected
      );
      if (transition.afterSelected !== selected) {
        failedLabels.push(label);
      }
      appliedLabels.add(label);
    }
  });

  return { availableLabels, failedLabels, missingLabels, scanCompleted: applyCompleted };
}

async function selectedLabelsForControl(root: ParentNode, control: ListControl): Promise<string[]> {
  if (control.kind === "checkbox") {
    return Array.from(control.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter((checkbox) => checkbox.checked || checkbox.getAttribute("aria-checked") === "true")
      .map(labelForCheckbox)
      .filter(Boolean);
  }

  let openedCombobox: HTMLElement | null = null;

  try {
    const readSelectedLabels = async (forceOpenDropdown = false): Promise<string[]> => {
      const options = await resolveSlicerOptions(root, control, {
        forceOpenDropdown,
        onOpened: (combobox) => {
          openedCombobox = combobox;
        }
      });
      const selectedLabels: string[] = [];

      await scanSlicerOptions(root, control, control.title, options, (currentOptions) => {
        selectedLabels.push(
          ...selectedLabelsFromSlicerOptions(currentOptions).filter((label) => !selectedLabels.includes(label))
        );
      });

      return selectedLabels;
    };

    const selectedLabels = await readSelectedLabels();
    if (selectedLabels.length > 0) {
      return selectedLabels;
    }

    if (hasGenericMultiSelectSummary(control)) {
      const reopenedSelectedLabels = await readSelectedLabels(true);
      if (reopenedSelectedLabels.length > 0) {
        return reopenedSelectedLabels;
      }
    }

    return selectedLabelsFromComboboxSummary(control);
  } finally {
    if (openedCombobox) {
      await closeSlicerDropdown(openedCombobox);
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

  const materializedOptions = liveSlicerListboxes(root, control, control.title).flatMap((listbox) =>
    optionsInListbox(listbox)
  );

  return selectedLabelsFromSlicerOptions(materializedOptions).length === 0;
}

export function createPowerBiDomAdapter(root: ParentNode = document): PowerBiDomAdapter {
  return {
    async waitForFilterControls(options = {}) {
      const timeoutMs = options.timeoutMs ?? 8000;
      const intervalMs = options.intervalMs ?? 250;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (listFilterControls(root).length > 0) {
          return true;
        }
        await delay(intervalMs);
      }

      return false;
    },

    async readListFilters() {
      const filters: FilterPresetItem[] = [];
      const controls = listFilterControls(root);
      const initialSlicerSelections = initiallyMaterializedSlicerSelections(root, controls);

      for (const control of controls) {
        const capturedLabels = await selectedLabelsForControl(root, control);
        const selectedLabels =
          control.kind === "slicer" && capturedLabels.length === 0
            ? initialSlicerSelections.get(control.title) ?? capturedLabels
            : capturedLabels;

        filters.push({
          title: control.title,
          type: "list" as const,
          selectedLabels
        });
      }

      return filters;
    },

    async applyListFilterSelection(title: string, selectedLabels: string[]) {
      const controls = matchingControls(root, title);

      if (controls.length === 0) {
        console.warn(LOG_PREFIX, "Filter was not found while applying preset", { title, desiredLabels: selectedLabels });
        return { title, status: "missing_filter", message: "Filter was not found." };
      }

      if (controls.length > 1) {
        console.warn(LOG_PREFIX, "More than one filter matched while applying preset", {
          title,
          desiredLabels: selectedLabels,
          matchCount: controls.length
        });
        return { title, status: "ambiguous_filter", message: "More than one filter matched this title." };
      }

      const control = controls[0];
      let openedCombobox: HTMLElement | null = null;

      try {
        if (control.kind === "slicer") {
          if (selectedLabels.length === 0 && isSlicerAlreadyClear(root, control)) {
            console.debug(LOG_PREFIX, "Applying list filter selection", {
              title,
              controlKind: control.kind,
              desiredLabels: selectedLabels,
              availableLabels: []
            });
            return {
              title,
              status: "applied",
              message: "Applied 0 values."
            };
          }

          const result = await applySlicerOptionsSelection(root, control, title, selectedLabels, {
            dropdownOptionsTimeoutMs: APPLY_DROPDOWN_OPTIONS_TIMEOUT_MS,
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

          if (!result.scanCompleted) {
            console.warn(LOG_PREFIX, "Timed out while scanning dropdown values", {
              title,
              desiredLabels: selectedLabels,
              availableLabels: result.availableLabels
            });
            return { title, status: "timeout", message: "Timed out while scanning dropdown values." };
          }

          if (result.failedLabels.length > 0) {
            console.warn(LOG_PREFIX, "Filter values failed while applying preset", {
              title,
              desiredLabels: selectedLabels,
              failedLabels: result.failedLabels,
              availableLabels: result.availableLabels
            });
            return {
              title,
              status: "interaction_failed",
              message: `Could not update values: ${result.failedLabels.join(", ")}.`
            };
          }

          if (result.missingLabels.length > 0) {
            console.warn(LOG_PREFIX, "Missing filter values while applying preset", {
              title,
              desiredLabels: selectedLabels,
              missingLabels: result.missingLabels,
              availableLabels: result.availableLabels
            });
            return { title, status: "missing_value", message: `Missing values: ${result.missingLabels.join(", ")}.` };
          }

          return {
            title,
            status: "applied",
            message: `Applied ${selectedLabels.length} ${selectedLabels.length === 1 ? "value" : "values"}.`
          };
        }

        const entries = Array.from(control.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map(
          (checkbox) => [labelForCheckbox(checkbox), checkbox] as const
        );
        const byLabel = new Map(entries.filter(([label]) => label.length > 0 && label !== "Select all"));
        const availableLabels = Array.from(byLabel.keys());
        const missing = selectedLabels.filter((label) => !byLabel.has(label));

        console.debug(LOG_PREFIX, "Applying list filter selection", {
          title,
          controlKind: control.kind,
          desiredLabels: selectedLabels,
          availableLabels
        });

        if (missing.length > 0) {
          console.warn(LOG_PREFIX, "Missing filter values while applying preset", {
            title,
            desiredLabels: selectedLabels,
            missingLabels: missing,
            availableLabels
          });
          return { title, status: "missing_value", message: `Missing values: ${missing.join(", ")}.` };
        }

        for (const [label, element] of byLabel) {
          const transition = setCheckbox(element, false);
          logSelectionTransition("Clearing filter value", title, control.kind, { ...transition, label }, false);
        }

        for (const label of selectedLabels) {
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

        return {
          title,
          status: "applied",
          message: `Applied ${selectedLabels.length} ${selectedLabels.length === 1 ? "value" : "values"}.`
        };
      } finally {
        if (openedCombobox) {
          await closeSlicerDropdown(openedCombobox, { title });
        }
      }
    }
  };
}
