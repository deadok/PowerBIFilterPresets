import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type LocaleCatalog = Record<string, { message: string }>;

function readCatalog(locale: string): LocaleCatalog {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "_locales", locale, "messages.json"), "utf8")
  ) as LocaleCatalog;
}

describe("locale catalogs", () => {
  it("keeps the Russian catalog aligned with the English source catalog", () => {
    const englishCatalog = readCatalog("en");
    const russianCatalog = readCatalog("ru");

    expect(Object.keys(russianCatalog).sort()).toEqual(Object.keys(englishCatalog).sort());
  });

  it("keeps representative Russian substitutions and product terms localized", () => {
    const russianCatalog = readCatalog("ru");

    expect(russianCatalog.popupDeleteDialogDescription?.message).toContain("$1");
    expect(russianCatalog.popupDeleteDialogDescription?.message).toContain("пресет");
    expect(russianCatalog.resultLogLineTemplate?.message).toContain("$1");
    expect(russianCatalog.resultLogLineTemplate?.message).toContain("$2");
    expect(russianCatalog.popupHelpCopyDescription?.message).toContain("JSON");
    expect(russianCatalog.popupSiteAccessRecommendationDescription?.message).toContain("Power BI");
  });
});
