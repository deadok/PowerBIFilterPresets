export type FilterFrameProbe = {
  frameId: number;
  href: string;
  title: string;
  supportedFilterCount: number;
};

type FrameProbePayload = Omit<FilterFrameProbe, "frameId">;

export function probeFrameForSupportedFilters(): FrameProbePayload {
  const selector = [
    '[data-powerbi-filter="list"] input[type="checkbox"]',
    '.filter-card input[type="checkbox"]',
    '.slicer-container [role="listbox"] [role="option"]',
    '.slicer-container [role="combobox"]',
    '.slicer-container input[type="search"]',
    '.slicer-container [role="searchbox"]'
  ].join(",");

  return {
    href: location.href,
    title: document.title,
    supportedFilterCount: document.querySelectorAll(selector).length
  };
}

export function selectBestFrameForFilters(frames: FilterFrameProbe[]): number | undefined {
  const [best] = frames
    .filter((frame) => frame.supportedFilterCount > 0)
    .sort((left, right) => {
      const countDifference = right.supportedFilterCount - left.supportedFilterCount;
      if (countDifference !== 0) {
        return countDifference;
      }
      return Number(left.frameId === 0) - Number(right.frameId === 0);
    });

  return best?.frameId;
}

export async function findBestFrameForFilters(tabId: number): Promise<number | undefined> {
  if (!chrome.scripting?.executeScript) {
    return undefined;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: probeFrameForSupportedFilters
  });

  return selectBestFrameForFilters(
    results.flatMap((result) => {
      if (!result.result) {
        return [];
      }

      return [
        {
          frameId: result.frameId,
          href: result.result.href,
          title: result.result.title,
          supportedFilterCount: result.result.supportedFilterCount
        }
      ];
    })
  );
}
