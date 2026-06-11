export function getReleaseArtifactFileNames(version: string): {
  zipFileName: string;
  crxFileName: string;
  checksumsFileName: string;
} {
  return {
    zipFileName: `power-bi-filter-presets-${version}.zip`,
    crxFileName: `power-bi-filter-presets-${version}.crx`,
    checksumsFileName: "SHA256SUMS.txt"
  };
}
