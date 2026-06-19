import { formatResultLogLine } from "../shared/i18n/format";
import { summarizeResults } from "../shared/resultSummary";
import type { FilterOperationResult, OperationStatus } from "../shared/types";

export type ResultSeverity = "normal" | "error";

export type ResultLine = {
  text: string;
  severity: ResultSeverity;
};

function assertNever(value: never): never {
  throw new Error(`Unhandled operation status: ${String(value)}`);
}

export function createResultLine(text: string, severity: ResultSeverity): ResultLine {
  return { text, severity };
}

export function applyStatusSeverity(status: OperationStatus): ResultSeverity {
  switch (status) {
    case "applied":
      return "normal";
    case "missing_filter":
    case "ambiguous_filter":
    case "missing_value":
    case "timeout":
    case "interaction_failed":
      return "error";
    default:
      return assertNever(status);
  }
}

export function createApplyResultLines(results: FilterOperationResult[]): ResultLine[] {
  return [
    createResultLine(summarizeResults(results), "normal"),
    ...results.map((result) => createResultLine(formatResultLogLine(result.title, result.message), applyStatusSeverity(result.status)))
  ];
}

export function renderResult(element: HTMLOutputElement, content: ResultLine | ResultLine[]): void {
  const lines = Array.isArray(content) ? content : [content];
  const fragment = document.createDocumentFragment();

  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      fragment.append(document.createTextNode("\n"));
    }

    const lineElement = document.createElement("span");
    lineElement.className = "result-line";
    lineElement.dataset.severity = line.severity;
    lineElement.textContent = line.text;
    fragment.append(lineElement);
  }

  element.replaceChildren(fragment);
}
