import { describe, expect, it } from "vitest";
import { normalizePageUrl } from "../../src/shared/url";

describe("normalizePageUrl", () => {
  it("keeps origin, path, and query string", () => {
    expect(normalizePageUrl("https://portal.example.com/reports/sales?id=123&tab=main")).toBe(
      "https://portal.example.com/reports/sales?id=123&tab=main"
    );
  });

  it("removes hash fragments", () => {
    expect(normalizePageUrl("https://portal.example.com/reports/sales?id=123#section")).toBe(
      "https://portal.example.com/reports/sales?id=123"
    );
  });

  it("removes a trailing slash except at the origin root", () => {
    expect(normalizePageUrl("https://portal.example.com/reports/sales/")).toBe(
      "https://portal.example.com/reports/sales"
    );
    expect(normalizePageUrl("https://portal.example.com/")).toBe("https://portal.example.com/");
  });

  it("throws a clear error for invalid URLs", () => {
    expect(() => normalizePageUrl("not a url")).toThrow("Invalid page URL");
  });
});
