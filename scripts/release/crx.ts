import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";

export function validatePrivateKeyBase64(value: string): Buffer {
  if (value.trim().length === 0) {
    throw new Error("Missing CRX_PRIVATE_KEY_BASE64 secret value.");
  }

  const compactValue = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(compactValue)) {
    throw new Error("CRX_PRIVATE_KEY_BASE64 is not valid base64.");
  }

  const buffer = Buffer.from(compactValue, "base64");
  if (buffer.length === 0 || buffer.toString("base64").replace(/=+$/, "") !== compactValue.replace(/=+$/, "")) {
    throw new Error("CRX_PRIVATE_KEY_BASE64 is not valid base64.");
  }

  return buffer;
}

export async function withDecodedPrivateKeyFile<T>(
  base64Value: string,
  tempDir: string,
  callback: (keyPath: string) => Promise<T>
): Promise<T> {
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const keyPath = resolve(tempDir, "crx-signing-key.pem");
  const keyBuffer = validatePrivateKeyBase64(base64Value);

  writeFileSync(keyPath, keyBuffer, { mode: 0o600 });
  chmodSync(keyPath, 0o600);

  try {
    validatePrivateKeyFile(keyPath);
    return await callback(keyPath);
  } finally {
    await rm(keyPath, { force: true });
  }
}

export function validatePrivateKeyFile(keyPath: string): void {
  const rawKey = readFileSync(keyPath, "utf8");
  try {
    createPrivateKey(rawKey);
  } catch (error) {
    throw new Error(
      `Decoded CRX private key is invalid at ${keyPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if ((statSync(keyPath).mode & 0o777) !== 0o600) {
    throw new Error(`CRX private key permissions must be 0600 at ${keyPath}.`);
  }
}

export async function buildCrxFromZip(input: {
  zipPath: string;
  keyPath: string;
  outputPath: string;
}): Promise<void> {
  const zipPath = resolve(input.zipPath);
  const outputPath = resolve(input.outputPath);
  const keyPath = resolve(input.keyPath);
  const zipBuffer = await readFile(zipPath);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const command = resolve(
      process.cwd(),
      "node_modules",
      ".bin",
      process.platform === "win32" ? "crx3.cmd" : "crx3"
    );

    if (!existsSync(command)) {
      rejectPromise(new Error(`Missing local crx3 executable at ${command}. Run npm ci first.`));
      return;
    }

    const child = spawn(command, ["-p", keyPath, "-o", outputPath], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk) => stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(`crx3 exited with code ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`)
        );
        return;
      }
      resolvePromise();
    });
    child.stdin.end(zipBuffer);
  });

  const metadata = validateCrx3File(await readFile(outputPath));
  if (metadata.headerSize <= 0) {
    throw new Error(`Generated CRX file ${basename(outputPath)} has an empty CRX3 header.`);
  }
}

export function validateCrx3File(input: Buffer | string): { version: number; headerSize: number } {
  const buffer = typeof input === "string" ? readFileSync(input) : input;
  if (buffer.length < 16) {
    throw new Error("CRX file is too small to contain a valid CRX3 header.");
  }

  if (buffer.subarray(0, 4).toString("ascii") !== "Cr24") {
    throw new Error("CRX file is missing the Cr24 magic header.");
  }

  const version = buffer.readUInt32LE(4);
  if (version !== 3) {
    throw new Error(`Expected a CRX3 file, received CRX version ${version}.`);
  }

  const headerSize = buffer.readUInt32LE(8);
  const zipOffset = 12 + headerSize;
  if (buffer.length <= zipOffset + 3) {
    throw new Error("CRX3 file is truncated after the header.");
  }

  if (buffer.subarray(zipOffset, zipOffset + 4).toString("binary") !== "PK\u0003\u0004") {
    throw new Error("CRX3 file does not contain a ZIP payload after the CRX header.");
  }

  return { version, headerSize };
}

export function getExtensionIdFromPrivateKeyFile(keyPath: string): string {
  const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
  const publicKeyDer = createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  const digest = createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
  return [...digest]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
    .join("");
}
