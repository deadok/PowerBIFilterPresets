import { describe, expect, it, vi } from "vitest";
import {
  activateElement,
  closeDropdownOpenedForRead,
  dispatchKeyboardEvent,
  dispatchMouseEvent
} from "../../src/content/powerBiInteraction";

describe("Power BI interaction helpers", () => {
  it("uses native click by default for ordinary activation", () => {
    document.body.innerHTML = `<button id="target">Open</button>`;
    const target = document.querySelector<HTMLButtonElement>("#target")!;
    const click = vi.fn();
    const mouseEvents: string[] = [];
    target.addEventListener("click", click);
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      target.addEventListener(type, () => mouseEvents.push(type));
    }

    activateElement(target);

    expect(click).toHaveBeenCalledOnce();
    expect(mouseEvents).toEqual([]);
  });

  it("dispatches the Power BI mouse activation sequence when preferred", () => {
    document.body.innerHTML = `<button id="target">Open</button>`;
    const target = document.querySelector<HTMLButtonElement>("#target")!;
    const events: string[] = [];
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      target.addEventListener(type, (event) => {
        expect(event.bubbles).toBe(true);
        expect(event.cancelable).toBe(true);
        events.push(type);
      });
    }

    activateElement(target, { preferMouseEvents: true });

    expect(events).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  });

  it("dispatches fallback mouse and keyboard events with the requested type and key", () => {
    document.body.innerHTML = `<button id="target">Open</button>`;
    const target = document.querySelector<HTMLButtonElement>("#target")!;
    const mouse = vi.fn();
    const keyboard = vi.fn();
    target.addEventListener("mousedown", mouse);
    document.addEventListener("keydown", keyboard);

    expect(dispatchMouseEvent(target, "mousedown")).toBe(true);
    dispatchKeyboardEvent(document, "keydown", "Escape");

    expect(mouse).toHaveBeenCalledOnce();
    expect(keyboard).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
  });

  it("closes dropdowns through mouse activation followed by Escape", async () => {
    document.body.innerHTML = `<div role="combobox" tabindex="0">Product</div>`;
    const combobox = document.querySelector<HTMLElement>('[role="combobox"]')!;
    const events: string[] = [];
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      combobox.addEventListener(type, () => events.push(type));
    }
    document.addEventListener("keydown", (event) => events.push(`keydown:${event.key}`));

    await closeDropdownOpenedForRead(combobox, {
      delay: async () => undefined,
      logPrefix: "[test]",
      title: "Product"
    });

    expect(events).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click", "keydown:Escape"]);
    expect(debug).toHaveBeenCalledWith("[test]", "Closing dropdown", { title: "Product", key: "Escape" });
    expect(debug).toHaveBeenCalledWith("[test]", "Closed dropdown", { title: "Product", key: "Escape" });
    debug.mockRestore();
  });
});
