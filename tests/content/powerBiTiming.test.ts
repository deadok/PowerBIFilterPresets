import { describe, expect, it } from "vitest";
import { createDeterministicPowerBiTiming } from "../../src/content/powerBiTiming";

describe("Power BI timing helpers", () => {
  it("advances deterministic time without wall-clock waiting", async () => {
    const timing = createDeterministicPowerBiTiming();

    expect(timing.now()).toBe(0);
    await timing.delay(25);
    expect(timing.now()).toBe(25);
    await timing.delay(75);
    expect(timing.now()).toBe(100);
  });
});
