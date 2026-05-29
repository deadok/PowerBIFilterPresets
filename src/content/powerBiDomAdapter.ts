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

const DROPDOWN_OPTIONS_TIMEOUT_MS = 500;
const DROPDOWN_OPTIONS_INTERVAL_MS = 25;

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

function externalSlicerOptions(root: ParentNode, title: string): HTMLElement[] {
  const listboxes = Array.from(root.querySelectorAll<HTMLElement>('[role="listbox"]')).filter((listbox) => {
    const label = listbox.getAttribute("aria-label")?.trim();
    return label === title && !listbox.closest(".slicer-container");
  });

  return listboxes.flatMap((listbox) =>
    Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'))
  );
}

async function closeDropdownOpenedForRead(combobox: HTMLElement): Promise<void> {
  combobox.click();
  await delay(0);

  combobox.ownerDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await delay(0);
}

async function resolveSlicerOptions(
  root: ParentNode,
  control: SlicerControl,
  options: {
    closeAfterRead?: boolean;
    dropdownOptionsIntervalMs?: number;
    dropdownOptionsTimeoutMs?: number;
    onOpened?: (combobox: HTMLElement) => void;
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

  const existingExternalOptions = externalSlicerOptions(root, control.title);
  if (existingExternalOptions.length > 0) {
    return existingExternalOptions;
  }

  combobox.click();
  options.onOpened?.(combobox);
  const timeoutMs = options.dropdownOptionsTimeoutMs ?? DROPDOWN_OPTIONS_TIMEOUT_MS;
  const intervalMs = options.dropdownOptionsIntervalMs ?? DROPDOWN_OPTIONS_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let externalOptions = externalSlicerOptions(root, control.title);

  while (externalOptions.length === 0 && Date.now() <= deadline) {
    await delay(intervalMs);
    externalOptions = externalSlicerOptions(root, control.title);
  }

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

function setCheckbox(checkbox: HTMLInputElement, checked: boolean): void {
  if (checkbox.checked !== checked) {
    checkbox.click();
  }

  checkbox.checked = checked;
  checkbox.setAttribute("aria-checked", checked ? "true" : "false");
}

function setSlicerOption(option: HTMLElement, selected: boolean): void {
  const label = labelForSlicerOption(option);
  const findMatchingOptions = () =>
    Array.from(option.ownerDocument.querySelectorAll<HTMLElement>('[role="option"]')).filter(
      (currentOption) => currentOption === option || labelForSlicerOption(currentOption) === label
    );
  const liveOption = findMatchingOptions().find((currentOption) => currentOption.isConnected) ?? option;

  if (isSlicerOptionSelected(liveOption) !== selected) {
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
        return { title, status: "missing_filter", message: "Filter was not found." };
      }

      if (controls.length > 1) {
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
                }
              })).map((option) => [labelForSlicerOption(option), option] as const);

        const byLabel = new Map(entries.filter(([label]) => label.length > 0 && label !== "Select all"));
        const missing = selectedLabels.filter((label) => !byLabel.has(label));

        if (missing.length > 0) {
          return { title, status: "missing_value", message: `Missing values: ${missing.join(", ")}.` };
        }

        for (const element of byLabel.values()) {
          if (control.kind === "checkbox") {
            setCheckbox(element as HTMLInputElement, false);
          } else {
            setSlicerOption(element as HTMLElement, false);
          }
        }

        for (const label of selectedLabels) {
          const element = byLabel.get(label);
          if (element && control.kind === "checkbox") {
            setCheckbox(element as HTMLInputElement, true);
          }
          if (element && control.kind === "slicer") {
            setSlicerOption(element as HTMLElement, true);
          }
        }

        return {
          title,
          status: "applied",
          message: `Applied ${selectedLabels.length} ${selectedLabels.length === 1 ? "value" : "values"}.`
        };
      } finally {
        if (openedCombobox) {
          await closeDropdownOpenedForRead(openedCombobox);
        }
      }
    }
  };
}
