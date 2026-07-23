import {
  externalSlicerListboxes,
  isElementExplicitlyHidden,
  labelForSlicerOption,
  optionsInListbox,
  type SlicerControl
} from "./powerBiDiscovery";
import {
  slicerOptionLogicalPosition,
  slicerOptionLogicalSetSize,
  slicerOptionStableLogicalIdentity
} from "./powerBiLogicalRows";
import {
  scanSnapshotsByScrollbarDrag,
  scanSnapshotsByWheel,
  scrollElementForListbox,
  scrollPlanForElement,
  scrollSlicerSnapshotTo,
  shouldUseWheelFallback,
  type SlicerListboxSnapshot,
  type SnapshotScanResult
} from "./powerBiScrollStrategies";
import { defaultPowerBiTiming, type PowerBiTiming } from "./powerBiTiming";

const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
const SLICER_SCROLL_RENDER_TIMEOUT_MS = 300;
const SLICER_SCAN_SETTLE_STABLE_STEPS = 3;
const SLICER_SCAN_SETTLE_QUIESCENCE_MS = 700;
const SLICER_SCAN_SETTLE_TIMEOUT_MS = 1500;

type VisitedScrollPositions = Set<string>;
type ElementGenerations = {
  ids: WeakMap<HTMLElement, number>;
  nextId: number;
};
type TraversalFrontier = {
  lastForwardScrollTop: number;
};
type CoverageState =
  | { kind: "physical"; proven: boolean }
  | { kind: "logical"; expectedSize: number; identitiesByPosition: Map<number, string> };

export type SlicerScanObservation = {
  epoch: number;
  reset: boolean;
};

function generationIdFor(generations: ElementGenerations, element: HTMLElement): number {
  const existing = generations.ids.get(element);
  if (existing !== undefined) {
    return existing;
  }

  const id = generations.nextId;
  generations.nextId += 1;
  generations.ids.set(element, id);
  return id;
}

function snapshotGenerationKey(snapshot: SlicerListboxSnapshot, generations: ElementGenerations): string {
  return [
    generationIdFor(generations, snapshot.listbox),
    generationIdFor(generations, snapshot.scrollElement)
  ].join(":");
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

function listboxSnapshotsSignature(snapshots: SlicerListboxSnapshot[], generations: ElementGenerations): string {
  return snapshots
    .map((snapshot) => [snapshotGenerationKey(snapshot, generations), optionsSignature(snapshot.options)].join(":"))
    .join("\n");
}

function settledSnapshotsSignature(
  snapshots: SlicerListboxSnapshot[],
  generations: ElementGenerations
): string {
  return snapshots
    .map((snapshot) =>
      [
        snapshotGenerationKey(snapshot, generations),
        snapshot.scrollElement.scrollTop,
        snapshot.scrollElement.clientHeight,
        snapshot.scrollElement.scrollHeight,
        optionsSignature(snapshot.options)
      ].join(":")
    )
    .join("\n");
}

function hasVisibleSlicerLoader(snapshots: SlicerListboxSnapshot[]): boolean {
  const scopes = new Set<HTMLElement>();
  for (const snapshot of snapshots) {
    const scope =
      snapshot.listbox.closest<HTMLElement>(".slicer-dropdown-popup, .slicer-dropdown-popup-container") ??
      snapshot.listbox.closest<HTMLElement>(".slicerContainer");
    if (scope) {
      scopes.add(scope);
    }
  }

  for (const scope of scopes) {
    for (const loader of Array.from(scope.querySelectorAll<HTMLElement>(".slicer-dropdown-loader"))) {
      const style = loader.ownerDocument.defaultView?.getComputedStyle(loader);
      if (
        !loader.hidden &&
        loader.getAttribute("aria-hidden") !== "true" &&
        style?.display !== "none" &&
        style?.visibility !== "hidden"
      ) {
        return true;
      }
    }
  }

  return false;
}

function scrollPositionKey(
  snapshot: SlicerListboxSnapshot,
  scrollTop: number,
  generations: ElementGenerations
): string {
  return [snapshotGenerationKey(snapshot, generations), scrollTop].join(":");
}

function slicerOptionLogicalIdentity(option: HTMLElement): string | null {
  const stableIdentity = slicerOptionStableLogicalIdentity(option);
  if (stableIdentity) {
    return stableIdentity;
  }

  const label = labelForSlicerOption(option).normalize("NFKC").replace(/\s+/g, " ").trim();
  if (label) {
    return `label:${label}`;
  }

  return null;
}

function coverageIsComplete(coverage: CoverageState): boolean {
  if (coverage.kind === "physical") {
    return coverage.proven;
  }
  if (coverage.expectedSize <= 0 || coverage.identitiesByPosition.size < coverage.expectedSize) {
    return false;
  }

  const identities = new Set<string>();
  for (let position = 1; position <= coverage.expectedSize; position += 1) {
    const identity = coverage.identitiesByPosition.get(position);
    if (!identity) {
      return false;
    }
    identities.add(identity);
  }
  return identities.size === coverage.expectedSize;
}

function scrollPositionsFromCurrent(positions: number[], currentScrollTop: number): number[] {
  const forwardPositions = positions.filter((position) => position >= currentScrollTop);
  const wrappedPositions = positions.filter((position) => position < currentScrollTop);
  const maximumPosition = positions.at(-1);
  return [
    ...forwardPositions,
    ...wrappedPositions,
    ...(wrappedPositions.length > 0 && maximumPosition !== undefined ? [maximumPosition] : [])
  ];
}

export function liveSlicerListboxes(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  options: { visibleOnly?: boolean } = {}
): HTMLElement[] {
  const listboxes: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const addListbox = (listbox: HTMLElement) => {
    if (
      listbox.isConnected &&
      (!options.visibleOnly || !isElementExplicitlyHidden(listbox)) &&
      !seen.has(listbox)
    ) {
      seen.add(listbox);
      listboxes.push(listbox);
    }
  };

  Array.from(control.element.querySelectorAll<HTMLElement>('[role="listbox"]')).forEach(addListbox);
  externalSlicerListboxes(
    [root, control.element.ownerDocument],
    title,
    control.element.querySelector<HTMLElement>('[role="combobox"]')
  ).forEach(addListbox);

  return listboxes;
}

function slicerListboxSnapshots(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  options: { visibleOnly?: boolean } = {}
): SlicerListboxSnapshot[] {
  return liveSlicerListboxes(root, control, title, options).map((listbox) => ({
    listbox,
    scrollElement: scrollElementForListbox(listbox),
    options: optionsInListbox(listbox).filter(
      (option) => !options.visibleOnly || !isElementExplicitlyHidden(option)
    )
  }));
}

export function liveSlicerOptionByLabel(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  label: string,
  options: { visibleOnly?: boolean } = {}
): HTMLElement | null {
  for (const snapshot of slicerListboxSnapshots(root, control, title, options)) {
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
  intervalMs: number,
  timing: PowerBiTiming,
  generations: ElementGenerations,
  deadline: number,
  visibleOnly: boolean
): Promise<void> {
  const renderDeadline = Math.min(deadline, timing.now() + SLICER_SCROLL_RENDER_TIMEOUT_MS);

  while (timing.now() < renderDeadline) {
    const remainingMs = renderDeadline - timing.now();
    await timing.delay(Math.min(Math.max(1, intervalMs), remainingMs));

    const liveSnapshots = slicerListboxSnapshots(root, control, title, { visibleOnly });
    const liveSignature = listboxSnapshotsSignature(liveSnapshots, generations);
    if (liveSignature.length > 0 && liveSignature !== previousSignature) {
      return;
    }
  }
}

async function settleSlicerOptions(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  onOptions: (options: HTMLElement[]) => void | Promise<void>,
  intervalMs: number,
  timing: PowerBiTiming,
  visitedScrollPositions: VisitedScrollPositions,
  generations: ElementGenerations,
  frontier: TraversalFrontier,
  deadline: number,
  visibleOnly: boolean,
  coverageAllowsSettling: () => boolean
): Promise<boolean> {
  let stableSteps = 0;
  let scrollPlansCompleted = true;
  let previousSignature = settledSnapshotsSignature(
    slicerListboxSnapshots(root, control, title, { visibleOnly }),
    generations
  );
  let lastChangeAt = timing.now();
  const maxSteps = Math.max(
    1,
    Math.ceil(Math.max(0, deadline - timing.now()) / Math.max(1, intervalMs))
  );
  let settled = false;

  for (
    let step = 0;
    step < maxSteps &&
    timing.now() < deadline &&
    !settled;
    step += 1
  ) {
    const snapshotsBeforeDelay = slicerListboxSnapshots(root, control, title, { visibleOnly });
    let scannedNewPosition = false;
    if (!hasVisibleSlicerLoader(snapshotsBeforeDelay)) {
      for (const snapshot of snapshotsBeforeDelay) {
        const scrollPlan = scrollPlanForElement(snapshot.scrollElement);
        scrollPlansCompleted &&= scrollPlan.completed;
        const currentScrollTop = snapshot.scrollElement.scrollTop;
        visitedScrollPositions.add(scrollPositionKey(snapshot, currentScrollTop, generations));
        const unvisitedPosition = (position: number) =>
          !visitedScrollPositions.has(scrollPositionKey(snapshot, position, generations));
        const nextPosition =
          scrollPlan.positions.find((position) => position > currentScrollTop && unvisitedPosition(position)) ??
          scrollPlan.positions.find(unvisitedPosition);
        if (nextPosition !== undefined) {
          visitedScrollPositions.add(scrollPositionKey(snapshot, nextPosition, generations));
          scannedNewPosition = true;
          if (nextPosition > currentScrollTop) {
            frontier.lastForwardScrollTop = Math.max(frontier.lastForwardScrollTop, nextPosition);
          }
          scrollSlicerSnapshotTo(snapshot, nextPosition);
        }
      }
    }

    const remainingMs = deadline - timing.now();
    if (remainingMs <= 0) {
      return false;
    }
    await timing.delay(Math.min(Math.max(1, intervalMs), remainingMs));
    if (timing.now() >= deadline) {
      return false;
    }

    const liveSnapshots = slicerListboxSnapshots(root, control, title, { visibleOnly });
    for (const snapshot of liveSnapshots) {
      await onOptions(snapshot.options.filter((option) => option.isConnected));
    }

    const snapshotsAfterObservation = slicerListboxSnapshots(root, control, title, { visibleOnly });
    const currentSignature = settledSnapshotsSignature(snapshotsAfterObservation, generations);
    const hasLiveOptions = snapshotsAfterObservation.some((snapshot) =>
      snapshot.options.some((option) => option.isConnected)
    );
    const loaderVisible = hasVisibleSlicerLoader(snapshotsAfterObservation);
    if (!hasLiveOptions || loaderVisible || scannedNewPosition || currentSignature !== previousSignature) {
      stableSteps = 0;
      lastChangeAt = timing.now();
    } else {
      stableSteps += 1;
    }
    previousSignature = currentSignature;
    settled =
      hasLiveOptions &&
      !loaderVisible &&
      coverageAllowsSettling() &&
      stableSteps >= SLICER_SCAN_SETTLE_STABLE_STEPS &&
      timing.now() - lastChangeAt >= SLICER_SCAN_SETTLE_QUIESCENCE_MS;
  }

  return scrollPlansCompleted && settled;
}

export async function scanSlicerOptions(
  root: ParentNode,
  control: SlicerControl,
  title: string,
  initialOptions: HTMLElement[],
  onOptions: (options: HTMLElement[], observation: SlicerScanObservation) => void | Promise<void>,
  options: {
    deadline?: number;
    intervalMs?: number;
    timing?: PowerBiTiming;
    visibleOnly?: boolean;
  } = {}
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? DROPDOWN_OPTIONS_INTERVAL_MS;
  const timing = options.timing ?? defaultPowerBiTiming;
  const deadline = options.deadline ?? timing.now() + SLICER_SCAN_SETTLE_TIMEOUT_MS;
  const visibleOnly = options.visibleOnly ?? false;
  const visitedScrollPositions: VisitedScrollPositions = new Set();
  const generations: ElementGenerations = { ids: new WeakMap(), nextId: 1 };
  const frontier: TraversalFrontier = { lastForwardScrollTop: 0 };
  let observedOptions = false;
  let coverage: CoverageState = { kind: "physical", proven: false };
  let lastObservedGeneration: string | null = null;
  let epoch = 0;
  let unverifiableGenerationBoundary = false;
  const epochIdentities = new Set<string>();
  const coverageAllowsSettling = () => coverage.kind === "physical" || coverageIsComplete(coverage);
  const observeOptions = async (currentOptions: HTMLElement[]): Promise<void> => {
    if (currentOptions.length > 0) {
      observedOptions = true;
    }

    const listbox = currentOptions[0]?.closest<HTMLElement>('[role="listbox"]');
    const observedSnapshot = listbox
      ? {
          listbox,
          scrollElement: scrollElementForListbox(listbox),
          options: currentOptions
        }
      : null;
    const observedGeneration = observedSnapshot
      ? snapshotGenerationKey(observedSnapshot, generations)
      : null;
    const generationChanged =
      observedGeneration !== null &&
      lastObservedGeneration !== null &&
      observedGeneration !== lastObservedGeneration;
    if (observedGeneration !== null) {
      lastObservedGeneration = observedGeneration;
    }

    const positionedRows = currentOptions.flatMap((option) => {
      const position = slicerOptionLogicalPosition(option);
      const identity = slicerOptionLogicalIdentity(option);
      return position !== null && identity !== null ? [{ option, position, identity }] : [];
    });
    const batchIdentitiesByPosition = new Map<number, string>();
    const conflictingBatchPositions = new Set<number>();
    for (const { position, identity } of positionedRows) {
      const existingIdentity = batchIdentitiesByPosition.get(position);
      if (existingIdentity !== undefined && existingIdentity !== identity) {
        conflictingBatchPositions.add(position);
      } else if (existingIdentity === undefined) {
        batchIdentitiesByPosition.set(position, identity);
      }
    }
    const statedSizes = currentOptions
      .map(slicerOptionLogicalSetSize)
      .filter((size): size is number => size !== null);
    const batchExpectedSize = statedSizes.length > 0 ? Math.max(...statedSizes) : null;
    const authoritativeOptions =
      batchExpectedSize === null
        ? currentOptions
        : positionedRows
            .filter(({ position }) => !conflictingBatchPositions.has(position))
            .map(({ option }) => option);
    const currentIdentities = authoritativeOptions
      .map(slicerOptionLogicalIdentity)
      .filter((identity): identity is string => identity !== null);
    let compatibleEpoch = true;
    let epochReset = false;
    const hasUsableLogicalGenerationEvidence =
      batchExpectedSize !== null &&
      currentOptions.length > 0 &&
      positionedRows.length === currentOptions.length &&
      conflictingBatchPositions.size === 0;
    const hasPartiallyIdentifiableLogicalBatch =
      batchExpectedSize !== null && positionedRows.length !== currentOptions.length;
    const existingLogicalPositions =
      coverage.kind === "logical" ? Array.from(coverage.identitiesByPosition.keys()) : [];
    const batchPositions = positionedRows.map(({ position }) => position);
    const hasIdentityOverlap = currentIdentities.some((identity) => epochIdentities.has(identity));
    const hasTouchingLogicalRange =
      hasUsableLogicalGenerationEvidence &&
      existingLogicalPositions.length > 0 &&
      batchPositions.length > 0 &&
      Math.min(...batchPositions) <= Math.max(...existingLogicalPositions) + 1 &&
      Math.max(...batchPositions) >= Math.min(...existingLogicalPositions) - 1;

    if (hasPartiallyIdentifiableLogicalBatch || (batchExpectedSize !== null && conflictingBatchPositions.size > 0)) {
      compatibleEpoch = false;
      epochReset = true;
      epoch += 1;
      coverage = {
        kind: "logical",
        expectedSize: batchExpectedSize,
        identitiesByPosition: new Map()
      };
      visitedScrollPositions.clear();
      frontier.lastForwardScrollTop = 0;
      epochIdentities.clear();
    }

    if (generationChanged && !epochReset && !hasIdentityOverlap && !hasTouchingLogicalRange) {
      compatibleEpoch = false;
      epochReset = true;
      epoch += 1;
      coverage = { kind: "physical", proven: false };
      visitedScrollPositions.clear();
      frontier.lastForwardScrollTop = 0;
      epochIdentities.clear();
      unverifiableGenerationBoundary ||= currentIdentities.length === 0;
    }

    if (batchExpectedSize !== null) {
      let logicalCoverage =
        coverage.kind === "logical"
          ? coverage
          : { kind: "logical" as const, expectedSize: batchExpectedSize, identitiesByPosition: new Map<number, string>() };
      coverage = logicalCoverage;

      const existingPositions = Array.from(logicalCoverage.identitiesByPosition.keys());
      const positionConflict = positionedRows.some(({ position, identity }) => {
        const existingIdentity = logicalCoverage.identitiesByPosition.get(position);
        return existingIdentity !== undefined && existingIdentity !== identity;
      });
      const disconnectedBatch =
        generationChanged &&
        existingPositions.length > 0 &&
        batchPositions.length > 0 &&
        (Math.min(...batchPositions) > Math.max(...existingPositions) + 1 ||
          Math.max(...batchPositions) < Math.min(...existingPositions) - 1);

      if (positionConflict || disconnectedBatch) {
        compatibleEpoch = false;
        if (!epochReset) {
          epochReset = true;
          epoch += 1;
        }
        logicalCoverage = { kind: "logical", expectedSize: batchExpectedSize, identitiesByPosition: new Map() };
        coverage = logicalCoverage;
        visitedScrollPositions.clear();
        frontier.lastForwardScrollTop = 0;
        epochIdentities.clear();
      } else {
        logicalCoverage.expectedSize = Math.max(logicalCoverage.expectedSize, batchExpectedSize);
      }

      for (const { position, identity } of positionedRows) {
        if (!conflictingBatchPositions.has(position)) {
          logicalCoverage.identitiesByPosition.set(position, identity);
        }
      }
    }

    currentIdentities.forEach((identity) => epochIdentities.add(identity));

    await onOptions(authoritativeOptions, { epoch, reset: epochReset });

    if (
      compatibleEpoch &&
      generationChanged &&
      observedSnapshot &&
      observedSnapshot.scrollElement.scrollTop === 0 &&
      frontier.lastForwardScrollTop > 0
    ) {
      const maximumScrollTop = Math.max(
        0,
        observedSnapshot.scrollElement.scrollHeight - observedSnapshot.scrollElement.clientHeight
      );
      const restoredScrollTop = Math.min(frontier.lastForwardScrollTop, maximumScrollTop);
      if (restoredScrollTop > 0) {
        visitedScrollPositions.add(scrollPositionKey(observedSnapshot, 0, generations));
        visitedScrollPositions.add(scrollPositionKey(observedSnapshot, restoredScrollTop, generations));
        scrollSlicerSnapshotTo(observedSnapshot, restoredScrollTop);
        if (observedSnapshot.listbox.isConnected) {
          const restoredOptions = optionsInListbox(observedSnapshot.listbox).filter(
            (option) => !visibleOnly || !isElementExplicitlyHidden(option)
          );
          await observeOptions(restoredOptions);
        }
      }
    }
  };
  const initialListboxes = slicerListboxSnapshots(root, control, title, { visibleOnly });
  const listboxes =
    initialListboxes.length > 0
      ? initialListboxes
      : listboxesForOptions(initialOptions)
        .filter((listbox) => !visibleOnly || !isElementExplicitlyHidden(listbox))
        .map((listbox) => ({
          listbox,
          scrollElement: scrollElementForListbox(listbox),
          options: optionsInListbox(listbox).filter(
            (option) => !visibleOnly || !isElementExplicitlyHidden(option)
          )
        }));

  const seedOptions = initialOptions.filter(
    (option) => option.isConnected && (!visibleOnly || !isElementExplicitlyHidden(option))
  );
  if (timing.now() < deadline) {
    await observeOptions(seedOptions);
    for (const snapshot of initialListboxes) {
      await observeOptions(snapshot.options.filter((option) => option.isConnected));
    }
  }

  if (listboxes.length === 0) {
    if (timing.now() >= deadline) {
      return false;
    }
    if (coverage.kind === "physical") {
      coverage = { kind: "physical", proven: seedOptions.length > 0 };
    }
    return seedOptions.length > 0 && coverageIsComplete(coverage);
  }

  let completed = true;
  let fallbackNeeded = false;
  scanInitialListboxes: for (const initialSnapshot of listboxes) {
    if (timing.now() >= deadline) {
      completed = false;
      break;
    }
    const scrollPlan = scrollPlanForElement(initialSnapshot.scrollElement);
    completed &&= scrollPlan.completed;

    for (const scrollTop of scrollPositionsFromCurrent(scrollPlan.positions, initialSnapshot.scrollElement.scrollTop)) {
      if (timing.now() >= deadline) {
        completed = false;
        break scanInitialListboxes;
      }
      const snapshotsBeforeScroll = slicerListboxSnapshots(root, control, title, { visibleOnly });
      const snapshots = snapshotsBeforeScroll.length > 0 ? snapshotsBeforeScroll : [initialSnapshot];
      const signatureBeforeScroll = listboxSnapshotsSignature(snapshots, generations);
      let scrolled = false;

      for (const snapshot of snapshots) {
        visitedScrollPositions.add(scrollPositionKey(snapshot, scrollTop, generations));
        if (scrollTop > snapshot.scrollElement.scrollTop) {
          frontier.lastForwardScrollTop = Math.max(frontier.lastForwardScrollTop, scrollTop);
        }
        scrolled = scrollSlicerSnapshotTo(snapshot, scrollTop) || scrolled;
      }

      if (scrolled) {
        await waitForSlicerScrollRender(
          root,
          control,
          title,
          signatureBeforeScroll,
          intervalMs,
          timing,
          generations,
          deadline,
          visibleOnly
        );
      } else {
        const remainingMs = deadline - timing.now();
        if (remainingMs <= 0) {
          completed = false;
          break scanInitialListboxes;
        }
        await timing.delay(Math.min(Math.max(1, intervalMs), remainingMs));
      }

      if (timing.now() >= deadline) {
        completed = false;
        break scanInitialListboxes;
      }

      const liveSnapshots = slicerListboxSnapshots(root, control, title, { visibleOnly });
      const snapshotsAfterScroll = liveSnapshots.length > 0 ? liveSnapshots : [];
      for (const snapshot of snapshotsAfterScroll) {
        await observeOptions(snapshot.options.filter((option) => option.isConnected));
      }
    }

    fallbackNeeded ||= scrollPlan.wheelFallback && shouldUseWheelFallback(initialSnapshot.options.length);
  }

  const scanFallbacks = async (): Promise<SnapshotScanResult> => {
    const snapshotProvider = () => slicerListboxSnapshots(root, control, title, { visibleOnly });
    const snapshotsSignature = (snapshots: SlicerListboxSnapshot[]) =>
      listboxSnapshotsSignature(snapshots, generations);
    const snapshotsTopology = (snapshots: SlicerListboxSnapshot[]) =>
      snapshots.map((snapshot) => snapshotGenerationKey(snapshot, generations)).join("\n");
    const wheelOutcome = await scanSnapshotsByWheel({
      snapshotProvider,
      snapshotsSignature,
      snapshotsTopology,
      onOptions: observeOptions,
      intervalMs,
      timing,
      deadline
    });
    const topologyAfterWheel = snapshotsTopology(snapshotProvider());
    if (
      wheelOutcome.status === "complete" &&
      wheelOutcome.topology !== null &&
      wheelOutcome.topology === topologyAfterWheel &&
      coverage.kind === "logical" &&
      coverageIsComplete(coverage)
    ) {
      return "complete";
    }
    const scrollbarOutcome = await scanSnapshotsByScrollbarDrag({
      snapshotProvider,
      snapshotsSignature,
      snapshotsTopology,
      onOptions: observeOptions,
      intervalMs,
      timing,
      deadline
    });
    const finalTopology = snapshotsTopology(snapshotProvider());
    const outcomes = [wheelOutcome, scrollbarOutcome];

    if (
      finalTopology.length === 0 ||
      outcomes.some(
        ({ status, topology }) => status === "pending" || topology === null || topology !== finalTopology
      )
    ) {
      return "pending";
    }
    if (outcomes.some(({ status }) => status === "complete")) {
      return "complete";
    }
    return "exhausted";
  };

  let fallbackPending = false;
  if (fallbackNeeded && timing.now() < deadline) {
    const fallbackResult = await scanFallbacks();
    fallbackPending = fallbackResult === "pending";
    completed &&= fallbackResult !== "exhausted";
  }

  if (completed) {
    const settled = await settleSlicerOptions(
      root,
      control,
      title,
      observeOptions,
      intervalMs,
      timing,
      visitedScrollPositions,
      generations,
      frontier,
      deadline,
      visibleOnly,
      coverageAllowsSettling
    );
    completed &&= settled;
    if (settled && coverage.kind === "physical") {
      coverage = { kind: "physical", proven: true };
    }
  }

  if (completed && fallbackPending) {
    completed &&= (await scanFallbacks()) === "complete";
    const settled = await settleSlicerOptions(
      root,
      control,
      title,
      observeOptions,
      intervalMs,
      timing,
      visitedScrollPositions,
      generations,
      frontier,
      deadline,
      visibleOnly,
      coverageAllowsSettling
    );
    completed &&= settled;
    if (settled && coverage.kind === "physical") {
      coverage = { kind: "physical", proven: true };
    }
  }

  const finalSnapshots = slicerListboxSnapshots(root, control, title, { visibleOnly });
  if (
    finalSnapshots.length === 0 ||
    !finalSnapshots.some((snapshot) => snapshot.options.some((option) => option.isConnected))
  ) {
    completed = false;
  }

  return completed && observedOptions && !unverifiableGenerationBoundary && coverageIsComplete(coverage);
}
