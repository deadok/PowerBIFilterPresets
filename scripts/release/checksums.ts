import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export async function generateSha256SumsFile(
  artifactPaths: string[],
  outputPath: string
): Promise<string[]> {
  if (artifactPaths.length !== 2) {
    throw new Error("Expected exactly two release artifacts when generating SHA256SUMS.txt.");
  }

  const lines: string[] = [];
  const fileNames: string[] = [];
  for (const artifactPath of artifactPaths) {
    const absolutePath = resolve(artifactPath);
    const fileName = basename(absolutePath);
    fileNames.push(fileName);
    lines.push(`${await sha256ForFile(absolutePath)}  ${fileName}`);
  }

  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
  return fileNames;
}

export async function verifySha256SumsFile(filePath: string, baseDir?: string): Promise<string[]> {
  const absoluteFilePath = resolve(filePath);
  const targetBaseDir = resolve(baseDir ?? dirname(absoluteFilePath));
  const lines = (await readFile(absoluteFilePath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length !== 2) {
    throw new Error("SHA256SUMS.txt must contain exactly two entries.");
  }

  const fileNames: string[] = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})\s{2}(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid sha256sum line: ${line}`);
    }

    const expectedHash = match[1];
    const fileName = match[2];
    const artifactPath = resolve(targetBaseDir, fileName);
    if (!existsSync(artifactPath)) {
      throw new Error(`Missing checksum target: ${fileName}`);
    }

    const actualHash = await sha256ForFile(artifactPath);
    if (actualHash !== expectedHash) {
      throw new Error(`SHA256 mismatch for ${fileName}`);
    }

    fileNames.push(fileName);
  }

  return fileNames;
}

async function sha256ForFile(filePath: string): Promise<string> {
  const fileBuffer = await readFile(filePath);
  return createHash("sha256").update(fileBuffer).digest("hex");
}
