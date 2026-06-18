import { describe, expect, it } from "vitest";
import popupMarkup from "../../src/popup/popup.html?raw";
import { getPopupElements } from "../../src/popup/popupElements";

function renderPopup(): HTMLDivElement {
  const app = document.createElement("div");
  app.innerHTML = popupMarkup;
  return app;
}

describe("getPopupElements", () => {
  it("returns typed popup elements and selected-action buttons", () => {
    const elements = getPopupElements(renderPopup());

    expect(elements.popupContent).toBeInstanceOf(HTMLDivElement);
    expect(elements.pageStatus).toBeInstanceOf(HTMLParagraphElement);
    expect(elements.saveButton).toBeInstanceOf(HTMLButtonElement);
    expect(elements.helpButton).toBeInstanceOf(HTMLButtonElement);
    expect(elements.siteAccessRecommendationDialog).toBeInstanceOf(HTMLElement);
    expect(elements.dismissSiteAccessRecommendationButton).toBeInstanceOf(HTMLButtonElement);
    expect(elements.presetSelect).toBeInstanceOf(HTMLSelectElement);
    expect(elements.result).toBeInstanceOf(HTMLOutputElement);
    expect(elements.createJsonInput).toBeInstanceOf(HTMLTextAreaElement);
    expect(elements.selectedActionButtons).toEqual({
      apply: elements.applyButton,
      export: elements.exportButton,
      rename: elements.renameButton,
      delete: elements.deleteButton
    });
    expect(elements.iconButtons).toContain(elements.createButton);
    expect(elements.iconButtons).toContain(elements.exportButton);
    expect(elements.iconButtons).toContain(elements.renameButton);
    expect(elements.iconButtons).toContain(elements.deleteButton);
    expect(elements.iconButtons).toHaveLength(6);
  });

  it("fails clearly when required popup markup is missing", () => {
    const app = renderPopup();
    app.querySelector("#save-current")?.remove();

    expect(() => getPopupElements(app)).toThrow("Popup markup is missing #save-current.");
  });
});
