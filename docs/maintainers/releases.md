# Maintainer Release Process

Power BI Filter Presets uses a tag-driven GitHub Actions release process.

Technical release automation details live in `docs/release.md`. This document
describes the maintainer workflow. Full local artifact checks are documented in
`docs/release.md` and summarized in `validation.md`.

## Release checklist

1. Create or select a `type:release` GitHub Issue.
2. Confirm the target version, for example `0.2.0`.
3. Create a release branch from current `main`, for example
   `release/v0.2.0`.
4. Update both:
   - `package.json`
   - `manifest.json`
5. Keep root `package-lock.json` package metadata aligned when it contains a
   root package version.
6. Run release preparation validation on the release branch:

```bash
npm ci
npm run release:verify-source -- --tag v0.2.0 --commit HEAD --main-ref origin/main
npm test
npm run typecheck
npm run build
npm run release:verify-built -- --tag v0.2.0
```

7. Open a PR into `main`.
8. Merge only after explicit approval.
9. Fast-forward local `main` to the merged commit.
10. Create and push the matching stable tag from the merged local `main` commit
    matching `origin/main`:

```bash
git switch main
git merge --ff-only origin/main
npm run release:verify-source -- --tag v0.2.0 --commit HEAD --main-ref origin/main --require-reachability
git tag v0.2.0
git push origin v0.2.0
```

11. Verify the published GitHub Release exists and includes:
    - `power-bi-filter-presets-0.2.0.zip`
    - `power-bi-filter-presets-0.2.0.crx`
    - `SHA256SUMS.txt`

## Rules

- Tags use `vMAJOR.MINOR.PATCH`.
- The tag version must match `package.json`, `manifest.json`, and the built
  `dist/manifest.json`.
- The tagged commit must be reachable from `origin/main`.
- Do not retag, delete tags, or replace published artifacts without explicit
  remediation approval.
- Do not expose or handle the production CRX signing key in chat.

## Failure handling

- Version mismatch: fix source versions through a new commit or PR.
- Missing release secret: configure `CRX_PRIVATE_KEY_BASE64` and rerun the
  workflow.
- Existing published release: stop and investigate before attempting a
  corrected release.
- Failed draft release: rerun the workflow if the cause is fixed; the workflow
  handles stale draft cleanup.
