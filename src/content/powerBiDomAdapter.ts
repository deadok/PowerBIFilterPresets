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
      return {
        title,
        status: "interaction_failed",
        message: `Apply behavior is unavailable for ${selectedLabels.length} values in this adapter version.`
      };
    }
  };
}
