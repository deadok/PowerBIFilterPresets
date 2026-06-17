import {
  externalSlicerListboxes,
  labelForSlicerOption,
  optionsInListbox,
  type SlicerControl
} from "./powerBiDiscovery";
import {
  scanSnapshotsByScrollbarDrag,
  scanSnapshotsByWheel,
  scrollElementForListbox,
  scrollPlanForElement,
  scrollSlicerSnapshotTo,
  shouldUseWheelFallback,
  type SlicerListboxSnapshot
} from "./powerBiScrollStrategies";

const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
const SLICER_SCROLL_RENDER_TIMEOUT_MS = 200;

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
        scrolled = scrollSlicerSnapshotTo(snapshot, scrollTop) || scrolled;
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

    if (scrollPlan.wheelFallback && shouldUseWheelFallback(initialSnapshot.options.length)) {
      const snapshotProvider = () => slicerListboxSnapshots(root, control, title);
      const snapshotsSignature = (snapshots: SlicerListboxSnapshot[]) => listboxSnapshotsSignature(snapshots);

      await scanSnapshotsByWheel({
        snapshotProvider,
        snapshotsSignature,
        onOptions,
        intervalMs
      });
      await scanSnapshotsByScrollbarDrag({
        snapshotProvider,
        snapshotsSignature,
        onOptions,
        intervalMs
      });
    }
  }

  return completed;
}
