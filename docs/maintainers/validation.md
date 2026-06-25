# Validation Standards

Validation evidence must be fresh, explicit, and scoped to the task.

Do not claim that checks pass unless the command was run and the output was
read. If validation is blocked, report the blocker and the checks that did run.

## Docs-only changes

Use the relevant subset:

```bash
git diff --check
rg -n "TBD|TODO|FIXME|PLACEHOLDER" <changed-docs>
```

Example command matches inside documentation code fences are expected; interpret
them in context instead of treating every match as a failure automatically.

For Markdown links, inspect changed links manually or with an available link
checker when the task requires link validation.

## Product code changes

Default automated verification:

```bash
npm test
npm run typecheck
npm run build
```

If the issue narrows verification, report the narrower command and why it is
sufficient.

## Release changes

Branch-stage release validation before PR merge:

```bash
npm ci
npm run release:verify-source -- --tag vX.Y.Z --commit HEAD --main-ref origin/main
npm test
npm run typecheck
npm run build
npm run release:verify-built -- --tag vX.Y.Z
```

Final merged-main source gate before tagging:

```bash
git switch main
git merge --ff-only origin/main
npm run release:verify-source -- --tag vX.Y.Z --commit HEAD --main-ref origin/main --require-reachability
```

Full local artifact readiness is documented in `docs/release.md` and includes
`release:build-zip`, `release:sign-crx`, `release:checksums`,
`release:verify-checksums`, and `release:inspect` when local artifact validation
is required. Do not require production signing key handling in chat.

After publishing a tag, verify the GitHub Release exists and includes:

- `power-bi-filter-presets-X.Y.Z.zip`
- `power-bi-filter-presets-X.Y.Z.crx`
- `SHA256SUMS.txt`

## Manual validation

Manual validation is required when:

- the issue has `validation:manual-required`;
- the task changes Power BI DOM behavior;
- the task changes extension permissions, install flow, or release artifacts;
- the issue explicitly asks for standalone Chrome validation.

When applicable, use `docs/qa/manual-powerbi-portal-checklist.md` as the
canonical Power BI manual validation checklist.

Report manual validation as one of:

- completed, with concrete steps and observed result;
- not required, with reason;
- blocked, with exact blocker.

## Evidence format

Use this format in handoff messages and PRs:

```markdown
## Validation

- `npm test` — passed: 44 files / 344 tests
- `npm run typecheck` — passed
- `npm run build` — passed
- Manual validation — not run; not required for docs-only change
```
