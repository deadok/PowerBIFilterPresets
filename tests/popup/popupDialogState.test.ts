import { describe, expect, it } from "vitest";
import { createPopupDialogState } from "../../src/popup/popupDialogState";

function fixture() {
  document.body.innerHTML = `
    <main id="background"></main>
    <div id="backdrop" hidden>
      <section id="save" hidden><input id="name" /><button id="cancel">Cancel</button></section>
      <section id="rename" hidden><button id="rename-cancel">Cancel</button></section>
    </div>`;
  const background = document.querySelector<HTMLElement>("#background");
  const backdrop = document.querySelector<HTMLElement>("#backdrop");
  const save = document.querySelector<HTMLElement>("#save");
  const rename = document.querySelector<HTMLElement>("#rename");
  if (!background || !backdrop || !save || !rename) {
    throw new Error("Dialog fixture failed.");
  }
  return createPopupDialogState({
    background,
    backdrop,
    dialogs: { save, rename }
  });
}

describe("createPopupDialogState", () => {
  it("opens one dialog at a time and makes the background inert", () => {
    const state = fixture();

    expect(state.open("save")).toBe(true);
    expect(state.active).toBe("save");
    expect(document.querySelector<HTMLElement>("#save")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#backdrop")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#background")?.hasAttribute("inert")).toBe(true);
    expect(state.open("rename")).toBe(false);
  });

  it("closes only the active dialog", () => {
    const state = fixture();
    state.open("save");

    expect(state.close("rename")).toBe(false);
    expect(state.close("save")).toBe(true);
    expect(state.active).toBeUndefined();
    expect(document.querySelector<HTMLElement>("#save")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#backdrop")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>("#background")?.hasAttribute("inert")).toBe(false);
  });

  it("wraps Tab focus inside the active dialog", () => {
    const state = fixture();
    state.open("save");
    const name = document.querySelector<HTMLInputElement>("#name");
    const cancel = document.querySelector<HTMLButtonElement>("#cancel");
    if (!name || !cancel) {
      throw new Error("Focusable fixture failed.");
    }

    cancel.focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    expect(state.trapTab(forward)).toBe(true);
    expect(document.activeElement).toBe(name);

    name.focus();
    const backward = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    expect(state.trapTab(backward)).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });
});
