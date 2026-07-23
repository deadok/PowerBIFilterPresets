export type AuthoritativeSlicerLogicalRow = {
  expectedSize: number;
  identity: string;
  position: number;
};

function strictIntegerAttribute(value: string | null): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[+-]?\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function slicerOptionStableLogicalIdentity(option: HTMLElement): string | null {
  const rowId = option.getAttribute("data-row-id")?.trim();
  if (rowId) {
    return `row:${rowId}`;
  }

  for (const attribute of ["data-key", "data-value", "data-identity"] as const) {
    const value = option.getAttribute(attribute)?.trim();
    if (value) {
      return `${attribute}:${value}`;
    }
  }

  return null;
}

export function slicerOptionLogicalPosition(option: HTMLElement): number | null {
  const ariaPosition = strictIntegerAttribute(option.getAttribute("aria-posinset"));
  if (ariaPosition !== null && ariaPosition > 0) {
    return ariaPosition;
  }

  const rowIndex = strictIntegerAttribute(option.getAttribute("data-row-index"));
  return rowIndex !== null && rowIndex >= 0 ? rowIndex + 1 : null;
}

export function slicerOptionLogicalSetSize(option: HTMLElement): number | null {
  const setSize = strictIntegerAttribute(option.getAttribute("aria-setsize"));
  return setSize !== null && setSize > 0 ? setSize : null;
}

export function authoritativeSlicerLogicalRow(option: HTMLElement): AuthoritativeSlicerLogicalRow | null {
  const expectedSize = slicerOptionLogicalSetSize(option);
  const position = slicerOptionLogicalPosition(option);
  const identity = slicerOptionStableLogicalIdentity(option);

  if (
    expectedSize === null ||
    position === null ||
    position > expectedSize ||
    identity === null
  ) {
    return null;
  }

  return { expectedSize, identity, position };
}
