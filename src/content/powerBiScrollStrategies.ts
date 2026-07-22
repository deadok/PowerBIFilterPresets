import type { PowerBiTiming } from "./powerBiTiming";

export type SlicerListboxSnapshot = {
  listbox: HTMLElement;
  scrollElement: HTMLElement;
  options: HTMLElement[];
};

export type ScrollPlan = {
  completed: boolean;
  positions: number[];
  wheelFallback: boolean;
};

type SnapshotProvider = () => SlicerListboxSnapshot[];

type SnapshotScanOptions = {
  snapshotProvider: SnapshotProvider;
  snapshotsSignature: (snapshots: SlicerListboxSnapshot[]) => string;
  snapshotsTopology: (snapshots: SlicerListboxSnapshot[]) => string;
  onOptions: (options: HTMLElement[]) => void | Promise<void>;
  intervalMs: number;
  timing: PowerBiTiming;
  deadline: number;
  resetToStart?: boolean;
};

export type SnapshotScanResult = "complete" | "exhausted" | "pending";
export type SnapshotScanOutcome = {
  status: SnapshotScanResult;
  topology: string | null;
};

const SLICER_SCROLL_RENDER_TIMEOUT_MS = 200;
const SLICER_SCAN_MAX_SCROLL_STEPS = 160;
const SLICER_WHEEL_SCAN_DELTA_Y = 500;
const SLICER_WHEEL_SCAN_MAX_STEPS = 40;
const SLICER_WHEEL_SCAN_MIN_OPTIONS = 8;
const SLICER_WHEEL_SCAN_STABLE_STEPS = 3;
const SLICER_SCROLLBAR_DRAG_MAX_STEPS = 30;
const SLICER_SCROLLBAR_DRAG_STABLE_STEPS = 3;

export function shouldUseWheelFallback(initialOptionCount: number): boolean {
  return initialOptionCount >= SLICER_WHEEL_SCAN_MIN_OPTIONS;
}

export function scrollElementForListbox(listbox: HTMLElement): HTMLElement {
  const descendantScrollElements = Array.from(
    listbox.querySelectorAll<HTMLElement>(".scroll-wrapper > .scroll-content, .scroll-content")
  );
  const descendantScrollElement = descendantScrollElements.find(
    (candidate) => candidate.clientHeight > 0 && candidate.scrollHeight > candidate.clientHeight
  );
  if (descendantScrollElement) {
    return descendantScrollElement;
  }

  let candidate: HTMLElement | null = listbox;

  while (candidate && candidate !== listbox.ownerDocument.body) {
    if (candidate.clientHeight > 0 && candidate.scrollHeight > candidate.clientHeight) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }

  return listbox;
}

export function scrollPlanForElement(element: HTMLElement): ScrollPlan {
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

export function scrollSlicerSnapshotTo(snapshot: SlicerListboxSnapshot, scrollTop: number): boolean {
  const deltaY = scrollTop - snapshot.scrollElement.scrollTop;
  dispatchWheel(snapshot.listbox, deltaY);
  if (snapshot.listbox !== snapshot.scrollElement) {
    dispatchWheel(snapshot.scrollElement, deltaY);
  }

  if (deltaY !== 0 && typeof snapshot.scrollElement.scrollBy === "function") {
    snapshot.scrollElement.scrollBy({ top: deltaY, behavior: "auto" });
  }

  snapshot.scrollElement.scrollTop = scrollTop;
  snapshot.scrollElement.dispatchEvent(new Event("scroll", { bubbles: true }));

  return deltaY !== 0;
}

async function waitForSnapshotRender(
  snapshotProvider: SnapshotProvider,
  snapshotsSignature: (snapshots: SlicerListboxSnapshot[]) => string,
  previousSignature: string,
  intervalMs: number,
  timing: PowerBiTiming,
  deadline: number
): Promise<void> {
  const renderDeadline = Math.min(deadline, timing.now() + SLICER_SCROLL_RENDER_TIMEOUT_MS);

  while (timing.now() < renderDeadline) {
    const remainingMs = renderDeadline - timing.now();
    await timing.delay(Math.min(Math.max(1, intervalMs), remainingMs));

    const liveSnapshots = snapshotProvider();
    const liveSignature = snapshotsSignature(liveSnapshots);
    if (liveSignature.length > 0 && liveSignature !== previousSignature) {
      return;
    }
  }
}

function exhaustedSnapshotOutcome(
  options: SnapshotScanOptions,
  initialTopology: string,
  topologyChanged: boolean
): SnapshotScanOutcome {
  const finalSnapshots = options.snapshotProvider();
  if (finalSnapshots.length === 0) {
    return { status: "pending", topology: null };
  }

  const finalTopology = options.snapshotsTopology(finalSnapshots);
  return {
    status: "exhausted",
    topology: !topologyChanged && finalTopology === initialTopology ? finalTopology : null
  };
}

export async function scanSnapshotsByWheel(options: SnapshotScanOptions): Promise<SnapshotScanOutcome> {
  let stableSteps = 0;
  const initialSnapshots = options.snapshotProvider();
  if (initialSnapshots.length === 0) {
    return { status: "pending", topology: null };
  }
  const initialTopology = options.snapshotsTopology(initialSnapshots);
  let topologyChanged = false;
  let previousSignature = options.snapshotsSignature(initialSnapshots);

  for (
    let step = 0;
    step < SLICER_WHEEL_SCAN_MAX_STEPS &&
    stableSteps < SLICER_WHEEL_SCAN_STABLE_STEPS &&
    options.timing.now() < options.deadline;
    step += 1
  ) {
    const snapshotsBeforeWheel = options.snapshotProvider();
    if (snapshotsBeforeWheel.length === 0) {
      return { status: "pending", topology: null };
    }

    for (const snapshot of snapshotsBeforeWheel) {
      dispatchWheel(snapshot.listbox, SLICER_WHEEL_SCAN_DELTA_Y);
      if (snapshot.scrollElement !== snapshot.listbox) {
        dispatchWheel(snapshot.scrollElement, SLICER_WHEEL_SCAN_DELTA_Y);
      }
    }

    await waitForSnapshotRender(
      options.snapshotProvider,
      options.snapshotsSignature,
      previousSignature,
      options.intervalMs,
      options.timing,
      options.deadline
    );

    if (options.timing.now() >= options.deadline) {
      return exhaustedSnapshotOutcome(options, initialTopology, topologyChanged);
    }

    const liveSnapshots = options.snapshotProvider();
    if (liveSnapshots.length === 0) {
      return { status: "pending", topology: null };
    }
    const liveTopology = options.snapshotsTopology(liveSnapshots);
    topologyChanged ||= liveTopology !== initialTopology;
    const liveSignature = options.snapshotsSignature(liveSnapshots);
    if (liveSignature === previousSignature) {
      stableSteps += 1;
    } else {
      stableSteps = 0;
      previousSignature = liveSignature;
    }

    for (const snapshot of liveSnapshots) {
      await options.onOptions(snapshot.options.filter((option) => option.isConnected));
    }

    const snapshotsAfterObservation = options.snapshotProvider();
    if (snapshotsAfterObservation.length === 0) {
      return { status: "pending", topology: null };
    }
    const topologyAfterObservation = options.snapshotsTopology(snapshotsAfterObservation);
    if (topologyAfterObservation !== liveTopology) {
      return { status: "pending", topology: null };
    }
    const signatureAfterObservation = options.snapshotsSignature(snapshotsAfterObservation);
    if (signatureAfterObservation !== liveSignature) {
      stableSteps = 0;
      previousSignature = signatureAfterObservation;
    }
  }

  const finalSnapshots = options.snapshotProvider();
  if (finalSnapshots.length === 0) {
    return { status: "pending", topology: null };
  }
  const finalTopology = options.snapshotsTopology(finalSnapshots);
  if (stableSteps >= SLICER_WHEEL_SCAN_STABLE_STEPS) {
    return { status: "complete", topology: finalTopology };
  }
  return {
    status: "exhausted",
    topology: !topologyChanged && finalTopology === initialTopology ? finalTopology : null
  };
}

export async function scanSnapshotsByScrollbarDrag(options: SnapshotScanOptions): Promise<SnapshotScanOutcome> {
  let stableSteps = 0;
  const initialSnapshots = options.snapshotProvider();
  if (initialSnapshots.length === 0) {
    return { status: "pending", topology: null };
  }
  const initialTopology = options.snapshotsTopology(initialSnapshots);
  let topologyChanged = false;
  let previousSignature = options.snapshotsSignature(initialSnapshots);
  if (options.timing.now() >= options.deadline) {
    return exhaustedSnapshotOutcome(options, initialTopology, topologyChanged);
  }
  let resetToStart = false;
  if (options.resetToStart ?? true) {
    for (const snapshot of initialSnapshots) {
      resetToStart = dragVisibleVerticalScrollbar(snapshot.listbox, "start") || resetToStart;
    }
  }

  if (resetToStart) {
    await waitForSnapshotRender(
      options.snapshotProvider,
      options.snapshotsSignature,
      previousSignature,
      options.intervalMs,
      options.timing,
      options.deadline
    );
    if (options.timing.now() >= options.deadline) {
      return exhaustedSnapshotOutcome(options, initialTopology, topologyChanged);
    }
    const liveSnapshots = options.snapshotProvider();
    if (liveSnapshots.length === 0) {
      return { status: "pending", topology: null };
    }
    const liveTopology = options.snapshotsTopology(liveSnapshots);
    topologyChanged ||= liveTopology !== initialTopology;
    previousSignature = options.snapshotsSignature(liveSnapshots);
    for (const snapshot of liveSnapshots) {
      await options.onOptions(snapshot.options.filter((option) => option.isConnected));
    }
    const snapshotsAfterObservation = options.snapshotProvider();
    if (snapshotsAfterObservation.length === 0) {
      return { status: "pending", topology: null };
    }
    const topologyAfterObservation = options.snapshotsTopology(snapshotsAfterObservation);
    if (topologyAfterObservation !== liveTopology) {
      return { status: "pending", topology: null };
    }
    previousSignature = options.snapshotsSignature(snapshotsAfterObservation);
  }

  for (
    let step = 0;
    step < SLICER_SCROLLBAR_DRAG_MAX_STEPS &&
    stableSteps < SLICER_SCROLLBAR_DRAG_STABLE_STEPS &&
    options.timing.now() < options.deadline;
    step += 1
  ) {
    const snapshotsBeforeDrag = options.snapshotProvider();
    if (snapshotsBeforeDrag.length === 0) {
      return { status: "pending", topology: null };
    }

    let dragged = false;
    for (const snapshot of snapshotsBeforeDrag) {
      dragged = dragVisibleVerticalScrollbar(snapshot.listbox, "end") || dragged;
    }

    if (!dragged) {
      const finalTopology = options.snapshotsTopology(snapshotsBeforeDrag);
      return {
        status: "exhausted",
        topology: !topologyChanged && finalTopology === initialTopology ? finalTopology : null
      };
    }

    await waitForSnapshotRender(
      options.snapshotProvider,
      options.snapshotsSignature,
      previousSignature,
      options.intervalMs,
      options.timing,
      options.deadline
    );

    if (options.timing.now() >= options.deadline) {
      return exhaustedSnapshotOutcome(options, initialTopology, topologyChanged);
    }

    const liveSnapshots = options.snapshotProvider();
    if (liveSnapshots.length === 0) {
      return { status: "pending", topology: null };
    }
    const liveTopology = options.snapshotsTopology(liveSnapshots);
    topologyChanged ||= liveTopology !== initialTopology;
    const liveSignature = options.snapshotsSignature(liveSnapshots);
    if (liveSignature === previousSignature) {
      stableSteps += 1;
    } else {
      stableSteps = 0;
      previousSignature = liveSignature;
    }

    for (const snapshot of liveSnapshots) {
      await options.onOptions(snapshot.options.filter((option) => option.isConnected));
    }

    const snapshotsAfterObservation = options.snapshotProvider();
    if (snapshotsAfterObservation.length === 0) {
      return { status: "pending", topology: null };
    }
    const topologyAfterObservation = options.snapshotsTopology(snapshotsAfterObservation);
    if (topologyAfterObservation !== liveTopology) {
      return { status: "pending", topology: null };
    }
    const signatureAfterObservation = options.snapshotsSignature(snapshotsAfterObservation);
    if (signatureAfterObservation !== liveSignature) {
      stableSteps = 0;
      previousSignature = signatureAfterObservation;
    }
  }

  const finalSnapshots = options.snapshotProvider();
  if (finalSnapshots.length === 0) {
    return { status: "pending", topology: null };
  }
  const finalTopology = options.snapshotsTopology(finalSnapshots);
  if (stableSteps >= SLICER_SCROLLBAR_DRAG_STABLE_STEPS) {
    return { status: "complete", topology: finalTopology };
  }
  return {
    status: "exhausted",
    topology: !topologyChanged && finalTopology === initialTopology ? finalTopology : null
  };
}
