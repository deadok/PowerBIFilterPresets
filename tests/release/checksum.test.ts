import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateSha256SumsFile, verifySha256SumsFile } from "../../scripts/release/checksums";

describe("release checksums", () => {
  it("generates sha256sum -c compatible output for exactly the zip and crx artifacts", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-checksums-"));
    const zipPath = join(tempDir, "extension.zip");
    const crxPath = join(tempDir, "extension.crx");
    const sumsPath = join(tempDir, "SHA256SUMS.txt");
    writeFileSync(zipPath, "zip");
    writeFileSync(crxPath, "crx");

    await generateSha256SumsFile([zipPath, crxPath], sumsPath);
    await expect(verifySha256SumsFile(sumsPath, tempDir)).resolves.toEqual([
      "extension.zip",
      "extension.crx"
    ]);
  });
});
