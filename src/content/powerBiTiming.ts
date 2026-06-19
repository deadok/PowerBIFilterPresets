export type PowerBiTiming = {
  now(): number;
  delay(ms: number): Promise<void>;
};

export const defaultPowerBiTiming: PowerBiTiming = {
  now: () => Date.now(),
  delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
};

export function createDeterministicPowerBiTiming(initialNow = 0): PowerBiTiming {
  let now = initialNow;

  return {
    now: () => now,
    async delay(ms: number) {
      now += Math.max(1, ms);
      await Promise.resolve();
    }
  };
}
