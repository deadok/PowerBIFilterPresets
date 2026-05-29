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

const DROPDOWN_OPTIONS_TIMEOUT_MS = 500;
const DROPDOWN_OPTIONS_INTERVAL_MS = 25;
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
  const seen = new Set<HTMLElement>();

  for (const root of Array.isArray(roots) ? roots : [roots]) {
    const listboxes = Array.from(root.querySelectorAll<HTMLElement>('[role="listbox"]')).filter((listbox) => {
      const label = listbox.getAttribute("aria-label")?.trim();
      return label === title && !listbox.closest(".slicer-container");
    });

    for (const listbox of listboxes) {
      for (const option of Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))) {
        if (!seen.has(option)) {
          seen.add(option);
          options.push(option);
        }
      }
    }
  }

  return options;
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

function setSlicerOption(option: HTMLElement, selected: boolean): SelectionTransition {
  const label = labelForSlicerOption(option);
  const findMatchingOptions = () =>
    Array.from(option.ownerDocument.querySelectorAll<HTMLElement>('[role="option"]')).filter(
      (currentOption) => currentOption === option || labelForSlicerOption(currentOption) === label
    );
  const liveOption = findMatchingOptions().find((currentOption) => currentOption.isConnected) ?? option;
  const beforeSelected = isSlicerOptionSelected(liveOption);
  const clickAttempted = beforeSelected !== selected;

  if (clickAttempted) {
    liveOption.click();
  }

  const matchingOptions = findMatchingOptions();
  for (const currentOption of matchingOptions.length > 0 ? matchingOptions : [option]) {
    currentOption.setAttribute("aria-selected", selected ? "true" : "false");
    if (!selected) {
      currentOption.classList.remove("selected");
    }
    const checkboxMarkers = [
      ...(currentOption.classList.contains("slicerCheckbox") ? [currentOption] : []),
      ...Array.from(currentOption.querySelectorAll<HTMLElement>(".slicerCheckbox, .selected"))
    ];
    checkboxMarkers.forEach((element) => {
      element.classList.toggle("selected", selected);
    });
  }

  const updatedLiveOption = findMatchingOptions().find((currentOption) => currentOption.isConnected) ?? liveOption;

  return {
    label,
    beforeSelected,
    clickAttempted,
    afterSelected: isSlicerOptionSelected(updatedLiveOption)
  };
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
        const entries =
          control.kind === "checkbox"
            ? Array.from(control.element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map(
                (checkbox) => [labelForCheckbox(checkbox), checkbox] as const
              )
            : (await resolveSlicerOptions(root, control, {
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
              })).map((option) => [labelForSlicerOption(option), option] as const);

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
          let transition: SelectionTransition;
          if (control.kind === "checkbox") {
            transition = setCheckbox(element as HTMLInputElement, false);
          } else {
            transition = setSlicerOption(element as HTMLElement, false);
          }
          logSelectionTransition("Clearing filter value", title, control.kind, { ...transition, label }, false);
        }

        for (const label of selectedLabels) {
          const element = byLabel.get(label);
          if (element && control.kind === "checkbox") {
            logSelectionTransition(
              "Selecting filter value",
              title,
              control.kind,
              { ...setCheckbox(element as HTMLInputElement, true), label },
              true
            );
          }
          if (element && control.kind === "slicer") {
            logSelectionTransition(
              "Selecting filter value",
              title,
              control.kind,
              { ...setSlicerOption(element as HTMLElement, true), label },
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
