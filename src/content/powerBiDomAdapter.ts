import type { FilterOperationResult, FilterPresetItem } from "../shared/types";
import {
  externalSlicerListboxes,
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

type SlicerListboxSnapshot = {
  listbox: HTMLElement;
  scrollElement: HTMLElement;
  options: HTMLElement[];
};

type ScrollPlan = {
  completed: boolean;
  positions: number[];
  wheelFallback: boolean;
};

const DROPDOWN_OPTIONS_TIMEOUT_MS = 1500;
const APPLY_DROPDOWN_OPTIONS_TIMEOUT_MS = 5000;
const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
const SLICER_SELECTION_VERIFY_TIMEOUT_MS = 250;
const SLICER_SCROLL_RENDER_TIMEOUT_MS = 200;
const SLICER_SCAN_MAX_SCROLL_STEPS = 160;
const SLICER_WHEEL_SCAN_DELTA_Y = 500;
const SLICER_WHEEL_SCAN_MAX_STEPS = 40;
const SLICER_WHEEL_SCAN_MIN_OPTIONS = 8;
const SLICER_WHEEL_SCAN_STABLE_STEPS = 3;
const SLICER_SCROLLBAR_DRAG_MAX_STEPS = 30;
const SLICER_SCROLLBAR_DRAG_STABLE_STEPS = 3;
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

function optionsSignature(options: HTMLElement[]): string {
  return options
    .filter((option) => option.isConnected)
    .map((option) =>
      [
        labelForSlicerOption(option),
        option.getAttribute("aria-selected") ?? "",
        option.getAttribute("class") ?? "",
        option.querySelector(".slicerCheckbox")?.getAttribute("class") ?? ""
      ].join(":")
    )
    .join("|");
}

function listboxSnapshotsSignature(snapshots: SlicerListboxSnapshot[]): string {
  return snapshots.map((snapshot) => optionsSignature(snapshot.options)).join("\n");
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
    return { completed: true, positions: [element.scrollTop], wheelFallback: true };
  }

  const step = Math.max(1, Math.floor(element.clientHeight * 0.8));
  const positions = new Set<number>([element.scrollTop, 0, maxScrollTop]);

  for (let scrollTop = 0; scrollTop < maxScrollTop; scrollTop += step) {
    positions.add(Math.min(scrollTop, maxScrollTop));
  }

  const sortedPositions = Array.from(positions).sort((left, right) => left - right);
  if (sortedPositions.length <= SLICER_SCAN_MAX_SCROLL_STEPS) {
    return { completed: true, positions: sortedPositions, wheelFallback: false };
  }

  return { completed: false, positions: sortedPositions.slice(0, SLICER_SCAN_MAX_SCROLL_STEPS), wheelFallback: false };
}

function dispatchWheel(element: HTMLElement, deltaY: number): void {
  const EventConstructor = element.ownerDocument.defaultView?.WheelEvent;
  const event =
    typeof EventConstructor === "function"
      ? new EventConstructor("wheel", { bubbles: true, cancelable: true, deltaY })
      : new Event("wheel", { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
}

function dispatchMouseDragEvent(
  target: EventTarget,
  document: Document,
  type: "mousedown" | "mousemove" | "mouseup",
  clientX: number,
  clientY: number
): void {
  const EventConstructor = document.defaultView?.MouseEvent;
  const buttons = type === "mouseup" ? 0 : 1;
  const event =
    typeof EventConstructor === "function"
      ? new EventConstructor(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons,
          clientX,
          clientY,
          screenX: clientX,
          screenY: clientY
        })
      : document.createEvent("MouseEvents");

  if (!("clientX" in event)) {
    (event as MouseEvent).initMouseEvent(
      type,
      true,
      true,
      document.defaultView ?? window,
      0,
      clientX,
      clientY,
      clientX,
      clientY,
      false,
      false,
      false,
      false,
      0,
      null
    );
  }

  target.dispatchEvent(event);
}

function visibleVerticalScrollbarForListbox(
  listbox: HTMLElement
): { scrollBar: HTMLElement; track: HTMLElement } | null {
  const searchRoot =
    listbox.closest<HTMLElement>(".scroll-wrapper, .slicer-dropdown-popup, .slicerContainer") ?? listbox;
  const scrollbars = Array.from(
    searchRoot.querySelectorAll<HTMLElement>(".scroll-element.scroll-y .scroll-bar, .scroll-y .scroll-bar")
  );

  for (const scrollBar of scrollbars) {
    const scrollBarRect = scrollBar.getBoundingClientRect();
    if (scrollBarRect.width <= 0 || scrollBarRect.height <= 0) {
      continue;
    }

    const track = scrollBar.closest<HTMLElement>(".scroll-element")?.querySelector<HTMLElement>(".scroll-element_track");
    const trackRect = track?.getBoundingClientRect();
    if (!track || !trackRect || trackRect.width <= 0 || trackRect.height <= 0) {
      continue;
    }

    return { scrollBar, track };
  }

  return null;
}

function dragVisibleVerticalScrollbar(listbox: HTMLElement, direction: "start" | "end"): boolean {
  const scrollbar = visibleVerticalScrollbarForListbox(listbox);
  if (!scrollbar) {
    return false;
  }

  const { scrollBar, track } = scrollbar;
  const scrollBarRect = scrollBar.getBoundingClientRect();
  const trackRect = track.getBoundingClientRect();
  const clientX = scrollBarRect.left + scrollBarRect.width / 2;
  const startY = scrollBarRect.top + scrollBarRect.height / 2;
  const endY = direction === "start" ? trackRect.top + 3 : trackRect.bottom - 3;

  if (Math.abs(endY - startY) < 1) {
    return false;
  }

  const document = scrollBar.ownerDocument;
  dispatchMouseDragEvent(scrollBar, document, "mousedown", clientX, startY);

  for (let step = 1; step <= 6; step += 1) {
    const clientY = startY + ((endY - startY) * step) / 6;
    dispatchMouseDragEvent(document, document, "mousemove", clientX, clientY);
    dispatchMouseDragEvent(scrollBar, document, "mousemove", clientX, clientY);
  }

  dispatchMouseDragEvent(document, document, "mouseup", clientX, endY);
  dispatchMouseDragEvent(scrollBar, document, "mouseup", clientX, endY);

  return true;
}

function scrollSlicerElement(scrollElement: HTMLElement, listbox: HTMLElement, scrollTop: number): boolean {
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

  return deltaY !== 0;
}

async function waitForSlicerScrollRender(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  previousSignature: string,
  intervalMs: number
): Promise<void> {
  const deadline = Date.now() + SLICER_SCROLL_RENDER_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    await delay(intervalMs);

    const liveSnapshots = slicerListboxSnapshots(root, control, title);
    const liveSignature = listboxSnapshotsSignature(liveSnapshots);
    if (liveSignature.length > 0 && liveSignature !== previousSignature) {
      return;
    }
  }
}

async function scanSlicerOptionsByWheel(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  onOptions: (options: HTMLElement[]) => void | Promise<void>,
  intervalMs: number
): Promise<void> {
  let stableSteps = 0;
  let previousSignature = listboxSnapshotsSignature(slicerListboxSnapshots(root, control, title));

  for (let step = 0; step < SLICER_WHEEL_SCAN_MAX_STEPS && stableSteps < SLICER_WHEEL_SCAN_STABLE_STEPS; step += 1) {
    const snapshotsBeforeWheel = slicerListboxSnapshots(root, control, title);
    if (snapshotsBeforeWheel.length === 0) {
      return;
    }

    for (const snapshot of snapshotsBeforeWheel) {
      dispatchWheel(snapshot.listbox, SLICER_WHEEL_SCAN_DELTA_Y);
      if (snapshot.scrollElement !== snapshot.listbox) {
        dispatchWheel(snapshot.scrollElement, SLICER_WHEEL_SCAN_DELTA_Y);
      }
    }

    await waitForSlicerScrollRender(root, control, title, previousSignature, intervalMs);

    const liveSnapshots = slicerListboxSnapshots(root, control, title);
    const liveSignature = listboxSnapshotsSignature(liveSnapshots);
    if (liveSignature === previousSignature) {
      stableSteps += 1;
    } else {
      stableSteps = 0;
      previousSignature = liveSignature;
    }

    for (const snapshot of liveSnapshots) {
      await onOptions(snapshot.options.filter((option) => option.isConnected));
    }
  }
}

async function scanSlicerOptionsByScrollbarDrag(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  onOptions: (options: HTMLElement[]) => void | Promise<void>,
  intervalMs: number
): Promise<void> {
  let stableSteps = 0;
  let previousSignature = listboxSnapshotsSignature(slicerListboxSnapshots(root, control, title));

  const initialSnapshots = slicerListboxSnapshots(root, control, title);
  let resetToStart = false;
  for (const snapshot of initialSnapshots) {
    resetToStart = dragVisibleVerticalScrollbar(snapshot.listbox, "start") || resetToStart;
  }

  if (resetToStart) {
    await waitForSlicerScrollRender(root, control, title, previousSignature, intervalMs);
    const liveSnapshots = slicerListboxSnapshots(root, control, title);
    previousSignature = listboxSnapshotsSignature(liveSnapshots);
    for (const snapshot of liveSnapshots) {
      await onOptions(snapshot.options.filter((option) => option.isConnected));
    }
  }

  for (
    let step = 0;
    step < SLICER_SCROLLBAR_DRAG_MAX_STEPS && stableSteps < SLICER_SCROLLBAR_DRAG_STABLE_STEPS;
    step += 1
  ) {
    const snapshotsBeforeDrag = slicerListboxSnapshots(root, control, title);
    if (snapshotsBeforeDrag.length === 0) {
      return;
    }

    let dragged = false;
    for (const snapshot of snapshotsBeforeDrag) {
      dragged = dragVisibleVerticalScrollbar(snapshot.listbox, "end") || dragged;
    }

    if (!dragged) {
      return;
    }

    await waitForSlicerScrollRender(root, control, title, previousSignature, intervalMs);

    const liveSnapshots = slicerListboxSnapshots(root, control, title);
    const liveSignature = listboxSnapshotsSignature(liveSnapshots);
    if (liveSignature === previousSignature) {
      stableSteps += 1;
    } else {
      stableSteps = 0;
      previousSignature = liveSignature;
    }

    for (const snapshot of liveSnapshots) {
      await onOptions(snapshot.options.filter((option) => option.isConnected));
    }
  }
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
      const signatureBeforeScroll = listboxSnapshotsSignature(snapshots);
      let scrolled = false;

      for (const snapshot of snapshots) {
        scrolled = scrollSlicerElement(snapshot.scrollElement, snapshot.listbox, scrollTop) || scrolled;
      }

      if (scrolled) {
        await waitForSlicerScrollRender(root, control, title, signatureBeforeScroll, intervalMs);
      } else {
        await delay(intervalMs);
      }

      const liveSnapshots = slicerListboxSnapshots(root, control, title);
      const snapshotsAfterScroll = liveSnapshots.length > 0 ? liveSnapshots : snapshots;
      for (const snapshot of snapshotsAfterScroll) {
        await onOptions(snapshot.options.filter((option) => option.isConnected));
      }
    }

    if (scrollPlan.wheelFallback && initialSnapshot.options.length >= SLICER_WHEEL_SCAN_MIN_OPTIONS) {
      await scanSlicerOptionsByWheel(root, control, title, onOptions, intervalMs);
      await scanSlicerOptionsByScrollbarDrag(root, control, title, onOptions, intervalMs);
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
