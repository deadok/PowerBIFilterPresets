import type { FilterOperationResult, FilterPresetItem } from "../shared/types";

type PowerBiDomAdapter = {
  readListFilters(): FilterPresetItem[];
  applyListFilterSelection(title: string, selectedLabels: string[]): Promise<FilterOperationResult>;
};

function textOf(element: Element | null): string {
  return element?.textContent?.trim().replace(/\s+/g, " ") ?? "";
}

function listFilterCards(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-powerbi-filter="list"], .filter-card')).filter(
    (card) => card.querySelector('input[type="checkbox"]') !== null
  );
}

function titleFor(card: HTMLElement): string {
  return textOf(card.querySelector(".filter-title, h3, [role='heading']"));
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

function matchingCards(root: ParentNode, title: string): HTMLElement[] {
  return listFilterCards(root).filter((card) => titleFor(card) === title);
}

function setCheckbox(checkbox: HTMLInputElement, checked: boolean): void {
  if (checkbox.checked !== checked) {
    checkbox.click();
  }

  checkbox.checked = checked;
  checkbox.setAttribute("aria-checked", checked ? "true" : "false");
}

export function createPowerBiDomAdapter(root: ParentNode = document): PowerBiDomAdapter {
  return {
    readListFilters() {
      return listFilterCards(root)
        .map((card) => {
          const title = titleFor(card);
          const selectedLabels = Array.from(card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
            .filter((checkbox) => checkbox.checked || checkbox.getAttribute("aria-checked") === "true")
            .map(labelForCheckbox)
            .filter(Boolean);

          return { title, type: "list" as const, selectedLabels };
        })
        .filter((filter) => filter.title.length > 0);
    },

    async applyListFilterSelection(title: string, selectedLabels: string[]) {
      const cards = matchingCards(root, title);

      if (cards.length === 0) {
        return { title, status: "missing_filter", message: "Filter was not found." };
      }

      if (cards.length > 1) {
        return { title, status: "ambiguous_filter", message: "More than one filter matched this title." };
      }

      const card = cards[0];
      const checkboxes = Array.from(card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      const byLabel = new Map(checkboxes.map((checkbox) => [labelForCheckbox(checkbox), checkbox]));
      const missing = selectedLabels.filter((label) => !byLabel.has(label));

      if (missing.length > 0) {
        return { title, status: "missing_value", message: `Missing values: ${missing.join(", ")}.` };
      }

      for (const checkbox of checkboxes) {
        setCheckbox(checkbox, false);
      }

      for (const label of selectedLabels) {
        const checkbox = byLabel.get(label);
        if (checkbox) {
          setCheckbox(checkbox, true);
        }
      }

      return {
        title,
        status: "applied",
        message: `Applied ${selectedLabels.length} ${selectedLabels.length === 1 ? "value" : "values"}.`
      };
    }
  };
}
