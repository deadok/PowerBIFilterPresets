import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function cssRule(selector: string): string {
  const css = readFileSync(resolve(process.cwd(), "src/popup/popup.css"), "utf8");
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));

  if (!match) {
    throw new Error(`Missing CSS rule for ${selector}.`);
  }

  return match[1];
}

describe("popup layout", () => {
  it("keeps an intrinsic expanded size while a full-screen dialog is open", () => {
    const rule = cssRule("body.review-open");

    expect(rule).toContain("width: var(--expanded-popup-width)");
    expect(rule).toContain("min-width: var(--expanded-popup-width)");
    expect(rule).toContain("height: var(--expanded-popup-height)");
    expect(rule).toContain("min-height: var(--expanded-popup-height)");
    expect(rule).not.toMatch(/(?:width|height): 100v[wh]/);
  });
});
