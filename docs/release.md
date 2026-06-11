# Release Automation

## Scope

Feature 5 adds a tag-driven GitHub Actions release flow for the extension. Releases run only for pushed stable tags matching `vMAJOR.MINOR.PATCH` and produce:

- `power-bi-filter-presets-VERSION.zip`
- `power-bi-filter-presets-VERSION.crx`
- `SHA256SUMS.txt`

The workflow validates source versions, build output, archive structure, checksums, and CRX3 structure before a GitHub Release is published.

## CRX Tooling Decision

Selected tooling: `crx3@2.0.0`

- Provenance:
  - pinned in [package.json](/Users/vladimir/Documents/Codex/chrome-power-bi/PowerBIFilterPresets/package.json)
  - locked in [package-lock.json](/Users/vladimir/Documents/Codex/chrome-power-bi/PowerBIFilterPresets/package-lock.json)
  - upstream package metadata from npm registry identifies `2.0.0` and repository `git://github.com/ahwayakchih/crx3.git`
  - upstream README in `node_modules/crx3/README.md` documents stdin ZIP to CRX3 conversion, Node 22+, and existing-key reuse

- Why it was chosen:
  - maintained recently and explicitly targets CRX3
  - works on Linux, macOS, and Windows
  - accepts an already-built ZIP on stdin, which lets this repo generate one ZIP and sign that exact payload into CRX
  - supports supplying an existing private key, which preserves extension identity when the same key is reused

- How output is validated:
  - ZIP is inspected to ensure `manifest.json` is at archive root and its version matches the tag
  - built manifest asset paths are revalidated before packaging
  - CRX is parsed structurally for `Cr24`, CRX version `3`, a non-empty header, and an embedded ZIP payload
  - checksums are generated and verified before publication

- Limitations:
  - Chrome may reject manually distributed CRX files outside supported enterprise/developer flows
  - CRX bitstreams are not promised to be reproducible across toolchain changes
  - the workflow validates structure and provenance, not Chrome Web Store proof

- Alternatives evaluated:
  - Chrome/Chromium `--pack-extension` style packaging was rejected because it couples release signing to browser-binary behavior instead of a pinned Node dependency, and the workflow does not rely on browser CLI packaging even though current GitHub-hosted Ubuntu images include Google Chrome
  - a repository-owned CRX3 signer was rejected because maintaining protobuf/header/signature correctness in-house is higher risk than pinning a maintained upstream tool

## Security Model

- Release workflow permissions are limited to `contents: write`.
- Only pushed tags matching `v*.*.*` trigger the workflow.
- Release logic rejects malformed and prerelease tags.
- The tagged commit must be reachable from `origin/main`.
- `package.json`, `manifest.json`, and `dist/manifest.json` must all match the tag version exactly.
- The signing secret must come from `CRX_PRIVATE_KEY_BASE64`.
- The private key is decoded only into a temporary runner directory.
- Decoded key permissions are restricted to `0600`.
- The workflow never prints, caches, uploads, or commits key material.
- Cleanup runs with `if: ${{ always() }}` and removes the temporary key directory even after failure.
- Releases are created as drafts first and published only after asset upload succeeds.
- Reruns delete stale drafts but refuse to replace an existing published release.

## Maintainer Setup

### Generate the production signing key

Generate the production CRX signing key offline. One acceptable example:

```bash
openssl genrsa -out power-bi-filter-presets.pem 4096
chmod 600 power-bi-filter-presets.pem
```

Keep the key offline after generation. Do not commit it, sync it through chat, or leave it in the repository.

### Record and back up the extension identity

The extension ID is derived from the signing key. Record it once and preserve it with the key backup:

```bash
npm run release:extension-id -- --key /absolute/path/to/power-bi-filter-presets.pem
```

Store:

- the private key
- the derived extension ID
- the date and operator who created it
- recovery instructions for the backup location

Use at least two offline backups in separate trusted locations.

### Configure GitHub secret

Base64-encode the PEM file and store the result in the repository secret `CRX_PRIVATE_KEY_BASE64`.

Example:

```bash
base64 < /absolute/path/to/power-bi-filter-presets.pem | tr -d '\n'
```

Then configure the secret in GitHub repository settings. This task does not create the real secret automatically.

## Release Process

1. Update `package.json` and `manifest.json` to the same release version through a normal PR.
2. Merge that PR to `main`.
3. Verify local release readiness:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run release:verify-source -- --tag v0.2.0 --commit HEAD --main-ref origin/main --require-reachability
npm run release:verify-built -- --tag v0.2.0
npm run release:build-zip -- --version 0.2.0 --dist dist --out-dir .release
npm run release:sign-crx -- --version 0.2.0 --zip .release/power-bi-filter-presets-0.2.0.zip --key /absolute/path/to/test-or-prod-key.pem --out-dir .release
npm run release:checksums -- --zip .release/power-bi-filter-presets-0.2.0.zip --crx .release/power-bi-filter-presets-0.2.0.crx --output .release/SHA256SUMS.txt
npm run release:verify-checksums -- --file .release/SHA256SUMS.txt --base-dir .release
npm run release:inspect -- --zip .release/power-bi-filter-presets-0.2.0.zip --crx .release/power-bi-filter-presets-0.2.0.crx --checksums .release/SHA256SUMS.txt
```

4. Create and push the tag explicitly:

```bash
git tag v0.2.0
git push origin v0.2.0
```

5. Monitor the GitHub Actions workflow and the draft release.
6. After success, install and spot-check the ZIP or CRX as appropriate for your environment.

## Artifact Verification

- Inspect archive contents:

```bash
npm run release:inspect -- --zip .release/power-bi-filter-presets-0.2.0.zip --crx .release/power-bi-filter-presets-0.2.0.crx --checksums .release/SHA256SUMS.txt
```

- Verify checksums locally:

```bash
npm run release:verify-checksums -- --file .release/SHA256SUMS.txt --base-dir .release
```

- Verify on Linux with standard tooling:

```bash
(
  cd .release
  sha256sum -c SHA256SUMS.txt
)
```

## Installation Notes

- ZIP artifact:
  - intended for unpacked extension loading from the built `dist/` contents packaged at archive root
- CRX artifact:
  - useful for controlled developer or enterprise distribution flows
  - Chrome restrictions vary by operating system and policy setup

Current Chrome documentation for alternative installation methods points maintainers toward preferences JSON on macOS/Linux and registry or policy-based flows on Windows. Treat the CRX as an enterprise/developer distribution artifact, not a Chrome Web Store substitute.

## Failure Recovery

- Malformed tag or version mismatch:
  - fix source versions or push the correct tag on the next approved attempt
- Reachability failure:
  - move the release change onto `main` and tag the correct commit
- Missing or invalid `CRX_PRIVATE_KEY_BASE64`:
  - fix the secret, then rerun the workflow
- Draft release exists from a failed run:
  - rerun the workflow; it deletes stale drafts automatically
- Published release already exists:
  - the workflow refuses replacement; investigate manually before any corrected release

The tag is preserved after failure. The workflow does not retag, delete tags, or publish partial public releases.

## Corrected Release Procedure

If the release candidate is wrong after tagging:

1. leave the pushed tag in place unless there is an explicitly approved remediation plan
2. fix the source on a new commit
3. update versions as needed
4. create a new approved stable tag for the corrected release

Do not silently replace published artifacts for an existing tag.

## Lost Key And Rotation Impact

- Lost key:
  - future CRX releases cannot preserve the same extension identity
  - the recorded extension ID becomes historical only
- Rotation:
  - requires explicit approval
  - creates a new extension identity
  - may require migration planning for enterprise installs or documented reinstall steps
