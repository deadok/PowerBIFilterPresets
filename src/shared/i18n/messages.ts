import englishMessages from "../../../_locales/en/messages.json";

type MessageDefinition = {
  message: string;
};

type SourceCatalog = Record<string, MessageDefinition>;
type TestCatalog = Partial<Record<MessageKey, string>>;

const sourceCatalog = englishMessages as SourceCatalog;

export type MessageKey = keyof typeof englishMessages;

let testCatalog: TestCatalog | undefined;

function applySubstitutions(template: string, substitutions?: string[]): string {
  if (!substitutions) {
    return template;
  }

  return substitutions.reduce(
    (result, substitution, index) => result.replaceAll(`$${index + 1}`, substitution),
    template
  );
}

function throwMissingMessage(key: MessageKey): never {
  throw new Error(`Missing i18n message for key: ${key}`);
}

export function installTestMessages(messages: TestCatalog): void {
  testCatalog = messages;
}

export function resetTestMessages(): void {
  testCatalog = undefined;
}

export function getMessage(key: MessageKey, substitutions?: string[]): string {
  const runtimeGetMessage = globalThis.chrome?.i18n?.getMessage;
  if (runtimeGetMessage) {
    const runtimeMessage = runtimeGetMessage(key, substitutions);
    if (runtimeMessage === "") {
      return throwMissingMessage(key);
    }

    return runtimeMessage;
  }

  const fallback = testCatalog !== undefined ? testCatalog[key] : sourceCatalog[key]?.message;
  if (!fallback) {
    return throwMissingMessage(key);
  }

  return applySubstitutions(fallback, substitutions);
}
