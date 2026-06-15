import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type TestBuild = {
  outDir: string;
  cleanup: () => void;
};

export async function buildExtensionForTest(): Promise<TestBuild> {
  const outDir = mkdtempSync(join(tmpdir(), "power-bi-filter-presets-build-"));

  try {
    execFileSync(
      process.execPath,
      [
        resolve(process.cwd(), "node_modules/vite/bin/vite.js"),
        "build",
        "--outDir",
        outDir
      ],
      {
        cwd: process.cwd(),
        stdio: "pipe"
      }
    );
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }

  return {
    outDir,
    cleanup: () => rmSync(outDir, { recursive: true, force: true })
  };
}
