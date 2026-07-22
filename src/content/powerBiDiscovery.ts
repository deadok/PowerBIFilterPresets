export type CheckboxControl = {
  kind: "checkbox";
  element: HTMLElement;
  title: string;
};

export type SlicerControl = {
  kind: "slicer";
  element: HTMLElement;
  title: string;
};

export type ListControl = CheckboxControl | SlicerControl;

export function textOf(element: Element | null): string {
  return element?.textContent?.trim().replace(/\s+/g, " ") ?? "";
}

export function checkboxFilterCards(root: ParentNode): CheckboxControl[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-powerbi-filter="list"], .filter-card'))
    .filter((card) => card.querySelector('input[type="checkbox"]') !== null)
    .map((element) => ({ kind: "checkbox" as const, element, title: titleForCheckboxCard(element) }))
    .filter((control) => control.title.length > 0);
}

export function slicerControls(root: ParentNode): SlicerControl[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".slicer-container"))
    .filter(
      (container) =>
        container.querySelector('[role="listbox"] [role="option"]') !== null ||
        container.querySelector('[role="combobox"]') !== null ||
        container.querySelector('input[type="search"], [role="searchbox"]') !== null
    )
    .map((element) => ({ kind: "slicer" as const, element, title: titleForSlicer(element) }))
    .filter((control) => control.title.length > 0);
}

export function listFilterControls(root: ParentNode): ListControl[] {
  return [...checkboxFilterCards(root), ...slicerControls(root)];
}

export function titleForCheckboxCard(card: HTMLElement): string {
  return textOf(card.querySelector(".filter-title, h3, [role='heading']"));
}

export function titleForSlicer(container: HTMLElement): string {
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

export function labelForCheckbox(checkbox: HTMLInputElement): string {
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

export function slicerOptions(control: SlicerControl): HTMLElement[] {
  return Array.from(control.element.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]'));
}

export function externalSlicerOptions(
  roots: ParentNode | ParentNode[],
  title: string,
  combobox?: HTMLElement | null
): HTMLElement[] {
  const options: HTMLElement[] = [];

  for (const listbox of externalSlicerListboxes(roots, title, combobox)) {
    options.push(...optionsInListbox(listbox));
  }

  return options;
}

export function externalSlicerListboxes(
  roots: ParentNode | ParentNode[],
  title: string,
  combobox?: HTMLElement | null
): HTMLElement[] {
  const controlledListboxes = combobox?.getAttribute("aria-controls")
    ?.trim()
    .split(/\s+/)
    .flatMap((id) => {
      const popup = combobox.ownerDocument.getElementById(id);
      const listbox = popup?.querySelector<HTMLElement>('[role="listbox"]');
      return popup?.isConnected && listbox && isExternalSlicerDropdownListbox(listbox) ? [listbox] : [];
    }) ?? [];
  if (controlledListboxes.length > 0) {
    return Array.from(new Set(controlledListboxes));
  }

  const listboxes: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const root of Array.isArray(roots) ? roots : [roots]) {
    const matchingListboxes = Array.from(root.querySelectorAll<HTMLElement>('[role="listbox"]')).filter((listbox) => {
      const label = listbox.getAttribute("aria-label")?.trim();
      return label === title && listbox.isConnected && !listbox.closest(".slicer-container") && isExternalSlicerDropdownListbox(listbox);
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

export function isElementExplicitlyHidden(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current && current !== element.ownerDocument.body) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      style?.display === "none" ||
      style?.visibility === "hidden"
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function isExternalSlicerDropdownListbox(listbox: HTMLElement): boolean {
  return (
    listbox.classList.contains("slicerBody") ||
    listbox.closest(".slicerContainer, .slicer-dropdown-popup, .slicer-dropdown-popup-container") !== null
  );
}

export function hasSlicerValueOption(options: HTMLElement[]): boolean {
  const listbox = options[0]?.closest<HTMLElement>('[role="listbox"]');
  if (options.length === 1 && listbox && isMultiSelectSlicerListbox(listbox)) {
    return false;
  }

  return options.some((option) => {
    const label = labelForSlicerOption(option);
    return label.length > 0 && label !== "Select all";
  });
}

export function isMultiSelectSlicerListbox(listbox: HTMLElement): boolean {
  return (
    listbox.getAttribute("aria-multiselectable") === "true" ||
    listbox.closest(".isMultiSelectEnabled") !== null
  );
}

export function labelForSlicerOption(option: HTMLElement): string {
  return (
    option.getAttribute("title")?.trim() ||
    option.getAttribute("aria-label")?.trim() ||
    textOf(option.querySelector(".slicerText")) ||
    textOf(option)
  );
}

export function selectedLabelsFromComboboxSummary(control: SlicerControl): string[] {
  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  const restatement = combobox ? combobox.querySelector(".slicer-restatement") : null;
  const summary = textOf(restatement) || textOf(combobox);
  const normalized = summary.trim();
  const genericSummaryPatterns = [/^all$/i, /multiple/i, /selected/i, /выбран/i, /значени/i, /элемент/i];

  if (
    normalized.length === 0 ||
    normalized.includes(",") ||
    normalized.includes(";") ||
    genericSummaryPatterns.some((pattern) => pattern.test(normalized))
  ) {
    return [];
  }

  return [normalized];
}

export function hasGenericMultiSelectSummary(control: SlicerControl): boolean {
  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  const restatement = combobox ? combobox.querySelector(".slicer-restatement") : null;
  const summary = textOf(restatement) || textOf(combobox);

  return /multiple/i.test(summary) || /выбран/i.test(summary) || /значени/i.test(summary) || /элемент/i.test(summary);
}

export function hasAllComboboxSummary(control: SlicerControl): boolean {
  const combobox = control.element.querySelector<HTMLElement>('[role="combobox"]');
  const restatement = combobox ? combobox.querySelector(".slicer-restatement") : null;
  const summary = textOf(restatement) || textOf(combobox);

  return /^all$/i.test(summary.trim());
}

export function isSlicerOptionSelected(option: HTMLElement): boolean {
  return (
    option.getAttribute("aria-selected") === "true" ||
    option.classList.contains("selected") ||
    option.querySelector(".slicerCheckbox.selected, .selected") !== null
  );
}

export function selectedLabelsFromSlicerOptions(options: HTMLElement[]): string[] {
  const selectedLabels: string[] = [];
  const seenLabels = new Set<string>();

  for (const option of options) {
    if (!isSlicerOptionSelected(option)) {
      continue;
    }

    const label = labelForSlicerOption(option);
    if (label.length === 0 || label === "Select all" || seenLabels.has(label)) {
      continue;
    }

    seenLabels.add(label);
    selectedLabels.push(label);
  }

  return selectedLabels;
}

export function matchingControls(root: ParentNode, title: string): ListControl[] {
  return listFilterControls(root).filter((control) => control.title === title);
}

export function optionsInListbox(listbox: HTMLElement): HTMLElement[] {
  return Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
}
