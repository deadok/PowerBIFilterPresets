import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCrxFromZip,
  validateCrx3File,
  validatePrivateKeyBase64,
  withDecodedPrivateKeyFile
} from "../../scripts/release/crx";

const tempPaths: string[] = [];

describe("crx release helpers", () => {
  afterEach(() => {
    for (const tempPath of tempPaths.splice(0)) {
      expect(() => statSync(tempPath)).toThrow();
    }
  });

  it("rejects missing signing secret values", () => {
    expect(() => validatePrivateKeyBase64("")).toThrow(/CRX_PRIVATE_KEY_BASE64/i);
  });

  it("rejects malformed base64 key material", () => {
    expect(() => validatePrivateKeyBase64("%%%")).toThrow(/base64/i);
  });

  it("rejects invalid private keys after decoding", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-crx-key-"));
    await expect(
      withDecodedPrivateKeyFile(Buffer.from("not a key").toString("base64"), tempDir, async () => undefined)
    ).rejects.toThrow(/private key/i);
  });

  it("cleans up decoded key material even when signing fails", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-crx-key-"));
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const base64Key = Buffer.from(
      privateKey.export({ type: "pkcs1", format: "pem" }).toString()
    ).toString("base64");

    await expect(
      withDecodedPrivateKeyFile(base64Key, tempDir, async (keyPath) => {
        tempPaths.push(keyPath);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  it("validates a structurally correct crx3 file header", () => {
    const header = Buffer.alloc(16);
    header.write("Cr24", 0, "ascii");
    header.writeUInt32LE(3, 4);
    header.writeUInt32LE(4, 8);
    header.writeUInt32LE(0, 12);
    const buffer = Buffer.concat([header, Buffer.from("PK\u0003\u0004", "binary")]);

    expect(validateCrx3File(buffer)).toEqual({
      version: 3,
      headerSize: 4
    });
  });

  it("can sign a zip into a crx when a disposable key is supplied", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "release-crx-sign-"));
    const zipPath = join(tempDir, "extension.zip");
    const crxPath = join(tempDir, "extension.crx");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const keyPath = join(tempDir, "test.pem");
    const zipBuffer = Buffer.from("PK\u0003\u0004test");

    writeFileSync(keyPath, privateKey.export({ type: "pkcs1", format: "pem" }).toString());
    writeFileSync(zipPath, zipBuffer);

    await buildCrxFromZip({ zipPath, keyPath, outputPath: crxPath });

    const metadata = validateCrx3File(readFileSync(crxPath));
    expect(metadata.version).toBe(3);
  });
});
