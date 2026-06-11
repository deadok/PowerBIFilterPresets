import { readFileSync } from "node:fs";

export function readJsonFile(path: string, label: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${path}: ${toErrorMessage(error)}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} at ${path}: ${toErrorMessage(error)}`);
  }
}

export function expectObjectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
