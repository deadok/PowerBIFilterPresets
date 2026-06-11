const STABLE_RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseStableReleaseTag(tag: string): string {
  const match = STABLE_RELEASE_TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error(
      `Expected a stable release tag matching vMAJOR.MINOR.PATCH, received "${tag}".`
    );
  }

  return `${match[1]}.${match[2]}.${match[3]}`;
}
