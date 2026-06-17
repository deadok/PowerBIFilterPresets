import {
  externalSlicerListboxes,
  labelForSlicerOption,
  optionsInListbox,
  type SlicerControl
} from "./powerBiDiscovery";

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

const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
const SLICER_SCROLL_RENDER_TIMEOUT_MS = 200;
const SLICER_SCAN_MAX_SCROLL_STEPS = 160;
const SLICER_WHEEL_SCAN_DELTA_Y = 500;
const SLICER_WHEEL_SCAN_MAX_STEPS = 40;
const SLICER_WHEEL_SCAN_MIN_OPTIONS = 8;
const SLICER_WHEEL_SCAN_STABLE_STEPS = 3;
const SLICER_SCROLLBAR_DRAG_MAX_STEPS = 30;
const SLICER_SCROLLBAR_DRAG_STABLE_STEPS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

export function liveSlicerListboxes(root: ParentNode, control: SlicerControl, title: string): HTMLElement[] {
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

export function liveSlicerOptionByLabel(
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

export async function scanSlicerOptions(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  initialOptions: HTMLElement[],
  onOptions: (options: HTMLElement[]) => void | Promise<void>,
  intervalMs = DROPDOWN_OPTIONS_INTERVAL_MS
): Promise<boolean> {
  const initialListboxes = slicerListboxSnapshots(root, control, title);
  const listboxes =
    initialListboxes.length > 0
      ? initialListboxes
      : listboxesForOptions(initialOptions).map((listbox) => ({
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
