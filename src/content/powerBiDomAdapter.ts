import type { FilterOperationResult, FilterPresetItem } from "../shared/types";

type PowerBiDomAdapter = {
  waitForFilterControls(options?: { timeoutMs?: number; intervalMs?: number }): Promise<boolean>;
  readListFilters(): Promise<FilterPresetItem[]>;
  applyListFilterSelection(title: string, selectedLabels: string[]): Promise<FilterOperationResult>;
};

type CheckboxControl = {
  kind: "checkbox";
  element: HTMLElement;
  title: string;
};

type SlicerControl = {
  kind: "slicer";
  element: HTMLElement;
  title: string;
};

type ListControl = CheckboxControl | SlicerControl;

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

type SlicerListboxSnapshot = {
  listbox: HTMLElement;
  scrollElement: HTMLElement;
  options: HTMLElement[];
};

type ScrollPlan = {
  completed: boolean;
  positions: number[];
};

const DROPDOWN_OPTIONS_TIMEOUT_MS = 500;
const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
const SLICER_SELECTION_VERIFY_TIMEOUT_MS = 250;
const SLICER_SCAN_MAX_SCROLL_STEPS = 160;
const LOG_PREFIX = "[Power BI Presets]";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function textOf(element: Element | null): string {
  return element?.textContent?.trim().replace(/\s+/g, " ") ?? "";
}

function checkboxFilterCards(root: ParentNode): CheckboxControl[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-powerbi-filter="list"], .filter-card'))
    .filter((card) => card.querySelector('input[type="checkbox"]') !== null)
    .map((element) => ({ kind: "checkbox" as const, element, title: titleForCheckboxCard(element) }))
    .filter((control) => control.title.length > 0);
}

function slicerControls(root: ParentNode): SlicerControl[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".slicer-container"))
    .filter(
      (container) =>
        container.querySelector('[role="listbox"] [role="option"]') !== null ||
        container.querySelector('[role="combobox"]') !== null
    )
    .map((element) => ({ kind: "slicer" as const, element, title: titleForSlicer(element) }))
    .filter((control) => control.title.length > 0);
}

function listFilterControls(root: ParentNode): ListControl[] {
  return [...checkboxFilterCards(root), ...slicerControls(root)];
}

function titleForCheckboxCard(card: HTMLElement): string {
  return textOf(card.querySelector(".filter-title, h3, [role='heading']"));
}

function titleForSlicer(container: HTMLElement): string {
  const header = container.querySelector<HTMLElement>(".slicer-header-text");
  const listbox = container.querySelector<HTMLElement>('[role="listbox"]');
  const combobox = container.querySelector<HTMLElement>('[role="combobox"]');

  return (
    header?.getAttribute("aria-label")?.trim() ||
    header?.getAttribute("title")?.trim() ||
    textOf(header) ||
    listbox?.getAttribute("aria-label")?.trim() ||
    combobox?.getAttribute("aria-label")?.trim() ||
    ""
  );
}

function labelForCheckbox(checkbox: HTMLInputElement): string {
  const label = checkbox.closest("label");
  if (label) {
    return textOf(label).replace(/^checked\s+/i, "");
  }

  const labelledBy = checkbox.getAttribute("aria-labelledby");
  if (labelledBy) {
    return textOf(checkbox.ownerDocument.getElementById(labelledBy));
  }

  return checkbox.getAttribute("aria-label")?.trim() ?? "";
}

function slicerOptions(control: SlicerControl): HTMLElement[] {
  return Array.from(control.element.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]'));
}

function externalSlicerOptions(roots: ParentNode | ParentNode[], title: string): HTMLElement[] {
  const options: HTMLElement[] = [];

  for (const listbox of externalSlicerListboxes(roots, title)) {
    options.push(...optionsInListbox(listbox));
  }

  return options;
}

function externalSlicerListboxes(roots: ParentNode | ParentNode[], title: string): HTMLElement[] {
  const listboxes: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const root of Array.isArray(roots) ? roots : [roots]) {
    const matchingListboxes = Array.from(root.querySelectorAll<HTMLElement>('[role="listbox"]')).filter((listbox) => {
      const label = listbox.getAttribute("aria-label")?.trim();
      return label === title && listbox.isConnected && !listbox.closest(".slicer-container");
    });

    for (const listbox of matchingListboxes) {
      if (!seen.has(listbox)) {
        seen.add(listbox);
        listboxes.push(listbox);
      }
    }
  }

  return listboxes;
}

async function closeDropdownOpenedForRead(combobox: HTMLElement, options: { title?: string } = {}): Promise<void> {
  if (options.title) {
    console.debug(LOG_PREFIX, "Closing dropdown", { title: options.title, key: "Escape" });
  }
  combobox.click();
  await delay(0);

  combobox.ownerDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await delay(0);

  if (options.title) {
    console.debug(LOG_PREFIX, "Closed dropdown", { title: options.title, key: "Escape" });
  }
}

async function resolveSlicerOptions(
  root: ParentNode,
  control: SlicerControl,
  options: {
    closeAfterRead?: boolean;
    dropdownOptionsIntervalMs?: number;
    dropdownOptionsTimeoutMs?: number;
    onOpened?: (combobox: HTMLElement) => void;
    onResolvedExternalOptions?: (optionCount: number) => void;
    onWaitingForExternalOptions?: (timeoutMs: number, intervalMs: number) => void;
  } = {}
): Promise<HTMLElement[]> {
  const inlineOptions = slicerOptions(control);
  if (inlineOptions.length > 0) {
    return inlineOptions;
  }

  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  if (!combobox) {
    return [];
  }

  const dropdownRoots = [root, combobox.ownerDocument];
  const existingExternalOptions = externalSlicerOptions(dropdownRoots, control.title);
  if (existingExternalOptions.length > 0) {
    return existingExternalOptions;
  }

  combobox.click();
  options.onOpened?.(combobox);
  const timeoutMs = options.dropdownOptionsTimeoutMs ?? DROPDOWN_OPTIONS_TIMEOUT_MS;
  const intervalMs = options.dropdownOptionsIntervalMs ?? DROPDOWN_OPTIONS_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let externalOptions = externalSlicerOptions(dropdownRoots, control.title);
  options.onWaitingForExternalOptions?.(timeoutMs, intervalMs);

  while (externalOptions.length === 0 && Date.now() <= deadline) {
    await delay(intervalMs);
    externalOptions = externalSlicerOptions(dropdownRoots, control.title);
  }

  options.onResolvedExternalOptions?.(externalOptions.length);

  if (options.closeAfterRead) {
    await closeDropdownOpenedForRead(combobox);
  }

  return externalOptions;
}

function labelForSlicerOption(option: HTMLElement): string {
  return (
    option.getAttribute("title")?.trim() ||
    option.getAttribute("aria-label")?.trim() ||
    textOf(option.querySelector(".slicerText")) ||
    textOf(option)
  );
}

function isSlicerOptionSelected(option: HTMLElement): boolean {
  return (
    option.getAttribute("aria-selected") === "true" ||
    option.classList.contains("selected") ||
    option.querySelector(".slicerCheckbox.selected, .selected") !== null
  );
}

function matchingControls(root: ParentNode, title: string): ListControl[] {
  return listFilterControls(root).filter((control) => control.title === title);
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
    checkbox.click();
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
    liveOption.click();
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

function listboxesForOptions(options: HTMLElement[]): HTMLElement[] {
  const listboxes: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const option of options) {
    const listbox = option.closest<HTMLElement>('[role="listbox"]');
    if (listbox && !seen.has(listbox)) {
      seen.add(listbox);
      listboxes.push(listbox);
    }
  }

  return listboxes;
}

function optionsInListbox(listbox: HTMLElement): HTMLElement[] {
  return Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
}

function liveSlicerListboxes(root: ParentNode, control: SlicerControl, title: string): HTMLElement[] {
  const listboxes: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const addListbox = (listbox: HTMLElement) => {
    if (listbox.isConnected && !seen.has(listbox)) {
      seen.add(listbox);
      listboxes.push(listbox);
    }
  };

  Array.from(control.element.querySelectorAll<HTMLElement>('[role="listbox"]')).forEach(addListbox);
  externalSlicerListboxes([root, control.element.ownerDocument], title).forEach(addListbox);

  return listboxes;
}

function slicerListboxSnapshots(root: ParentNode, control: SlicerControl, title: string): SlicerListboxSnapshot[] {
  return liveSlicerListboxes(root, control, title).map((listbox) => ({
    listbox,
    scrollElement: scrollElementForListbox(listbox),
    options: optionsInListbox(listbox)
  }));
}

function liveSlicerOptionByLabel(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  label: string
): HTMLElement | null {
  for (const snapshot of slicerListboxSnapshots(root, control, title)) {
    const option = snapshot.options.find((currentOption) => labelForSlicerOption(currentOption) === label);
    if (option) {
      return option;
    }
  }

  return null;
}

function scrollElementForListbox(listbox: HTMLElement): HTMLElement {
  let candidate: HTMLElement | null = listbox;

  while (candidate && candidate !== listbox.ownerDocument.body) {
    if (candidate.clientHeight > 0 && candidate.scrollHeight > candidate.clientHeight) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }

  return listbox;
}

function scrollPlanForElement(element: HTMLElement): ScrollPlan {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  if (maxScrollTop === 0 || element.clientHeight <= 0) {
    return { completed: true, positions: [element.scrollTop] };
  }

  const step = Math.max(1, Math.floor(element.clientHeight * 0.8));
  const positions = new Set<number>([element.scrollTop, 0, maxScrollTop]);

  for (let scrollTop = 0; scrollTop < maxScrollTop; scrollTop += step) {
    positions.add(Math.min(scrollTop, maxScrollTop));
  }

  const sortedPositions = Array.from(positions).sort((left, right) => left - right);
  if (sortedPositions.length <= SLICER_SCAN_MAX_SCROLL_STEPS) {
    return { completed: true, positions: sortedPositions };
  }

  return { completed: false, positions: sortedPositions.slice(0, SLICER_SCAN_MAX_SCROLL_STEPS) };
}

function dispatchWheel(element: HTMLElement, deltaY: number): void {
  const EventConstructor = element.ownerDocument.defaultView?.WheelEvent;
  const event =
    typeof EventConstructor === "function"
      ? new EventConstructor("wheel", { bubbles: true, cancelable: true, deltaY })
      : new Event("wheel", { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
}

function scrollSlicerElement(scrollElement: HTMLElement, listbox: HTMLElement, scrollTop: number): void {
  const deltaY = scrollTop - scrollElement.scrollTop;
  dispatchWheel(listbox, deltaY);
  if (listbox !== scrollElement) {
    dispatchWheel(scrollElement, deltaY);
  }

  if (deltaY !== 0 && typeof scrollElement.scrollBy === "function") {
    scrollElement.scrollBy({ top: deltaY, behavior: "auto" });
  }

  scrollElement.scrollTop = scrollTop;
  scrollElement.dispatchEvent(new Event("scroll", { bubbles: true }));
}

async function scanSlicerOptions(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  initialOptions: HTMLElement[],
  onOptions: (options: HTMLElement[]) => void | Promise<void>,
  intervalMs = DROPDOWN_OPTIONS_INTERVAL_MS
): Promise<boolean> {
  const initialListboxes = slicerListboxSnapshots(root, control, title);
  const listboxes = initialListboxes.length > 0 ? initialListboxes : listboxesForOptions(initialOptions).map((listbox) => ({
    listbox,
    scrollElement: scrollElementForListbox(listbox),
    options: optionsInListbox(listbox)
  }));

  if (listboxes.length === 0) {
    await onOptions(initialOptions.filter((option) => option.isConnected));
    return true;
  }

  let completed = true;
  for (const initialSnapshot of listboxes) {
    const scrollPlan = scrollPlanForElement(initialSnapshot.scrollElement);
    completed &&= scrollPlan.completed;

    for (const scrollTop of scrollPlan.positions) {
      const snapshotsBeforeScroll = slicerListboxSnapshots(root, control, title);
      const snapshots = snapshotsBeforeScroll.length > 0 ? snapshotsBeforeScroll : [initialSnapshot];

      for (const snapshot of snapshots) {
        scrollSlicerElement(snapshot.scrollElement, snapshot.listbox, scrollTop);
        await delay(intervalMs);
      }

      const liveSnapshots = slicerListboxSnapshots(root, control, title);
      const snapshotsAfterScroll = liveSnapshots.length > 0 ? liveSnapshots : snapshots;
      for (const snapshot of snapshotsAfterScroll) {
        await onOptions(snapshot.options.filter((option) => option.isConnected));
      }
    }
  }

  return completed;
}

async function applySlicerOptionsSelection(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  selectedLabels: string[],
  options: {
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

  const options = await resolveSlicerOptions(root, control, { closeAfterRead: true });

  return options
    .filter(isSlicerOptionSelected)
    .map(labelForSlicerOption)
    .filter((label) => label.length > 0 && label !== "Select all");
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

      for (const control of listFilterControls(root)) {
        filters.push({
          title: control.title,
          type: "list" as const,
          selectedLabels: await selectedLabelsForControl(root, control)
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
          const result = await applySlicerOptionsSelection(root, control, title, selectedLabels, {
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
          await closeDropdownOpenedForRead(openedCombobox, { title });
        }
      }
    }
  };
}
