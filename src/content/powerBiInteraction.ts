type Delay = (ms: number) => Promise<void>;

export type ActivationOptions = {
  preferMouseEvents?: boolean;
};

export type CloseDropdownOptions = {
  delay?: Delay;
  logPrefix?: string;
  title?: string;
};

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function dispatchMouseEvent(element: HTMLElement, type: string): boolean {
  const EventConstructor =
    type.startsWith("pointer") && typeof element.ownerDocument.defaultView?.PointerEvent === "function"
      ? element.ownerDocument.defaultView.PointerEvent
      : element.ownerDocument.defaultView?.MouseEvent;
  if (typeof EventConstructor === "function") {
    element.dispatchEvent(new EventConstructor(type, { bubbles: true, cancelable: true }));
    return true;
  }

  if (typeof element.ownerDocument.createEvent !== "function") {
    return false;
  }

  const event = element.ownerDocument.createEvent("MouseEvents");
  event.initMouseEvent(
    type,
    true,
    true,
    element.ownerDocument.defaultView ?? window,
    0,
    0,
    0,
    0,
    0,
    false,
    false,
    false,
    false,
    0,
    null
  );
  element.dispatchEvent(event);
  return true;
}

export function dispatchKeyboardEvent(document: Document, type: string, key: string): void {
  const EventConstructor = document.defaultView?.KeyboardEvent;
  if (typeof EventConstructor === "function") {
    document.dispatchEvent(new EventConstructor(type, { key, bubbles: true, cancelable: true }));
    return;
  }

  const event = document.createEvent("Events");
  event.initEvent(type, true, true);
  Object.defineProperty(event, "key", { configurable: true, value: key });
  document.dispatchEvent(event);
}

export function activateElement(element: HTMLElement, options: ActivationOptions = {}): void {
  if (!options.preferMouseEvents && typeof element.click === "function") {
    element.click();
    return;
  }

  const dispatched = [
    dispatchMouseEvent(element, "pointerdown"),
    dispatchMouseEvent(element, "mousedown"),
    dispatchMouseEvent(element, "pointerup"),
    dispatchMouseEvent(element, "mouseup"),
    dispatchMouseEvent(element, "click")
  ].some(Boolean);

  if (!dispatched && typeof element.click === "function") {
    element.click();
  }
}

export async function closeDropdownOpenedForRead(combobox: HTMLElement, options: CloseDropdownOptions = {}): Promise<void> {
  if (options.title && options.logPrefix) {
    console.debug(options.logPrefix, "Closing dropdown", { title: options.title, key: "Escape" });
  }
  activateElement(combobox, { preferMouseEvents: true });
  await (options.delay ?? defaultDelay)(0);

  dispatchKeyboardEvent(combobox.ownerDocument, "keydown", "Escape");
  await (options.delay ?? defaultDelay)(0);

  if (options.title && options.logPrefix) {
    console.debug(options.logPrefix, "Closed dropdown", { title: options.title, key: "Escape" });
  }
}
