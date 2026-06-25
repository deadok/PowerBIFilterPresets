# Manual Validation Playbook

## Purpose

Use this playbook when a change needs maintained manual evidence for standalone
Chrome or real Power BI behavior that automated tests cannot fully prove.
Automated checks cover unit behavior, build output, archive structure, and many
DOM fixtures; this guide covers the browser, extension, frame, and report states
that only a live Power BI context can confirm.

Keep shared notes sanitized. Do not include portal links, authentication
details, raw logs, screenshots, exported preset JSON, stale task status, or
branch history in validation reports.

## When manual validation is required

Manual validation is required when any of these apply:

- the GitHub issue has the `validation:manual-required` label;
- the change affects Power BI DOM discovery, save, capture, or apply behavior;
- the change affects extension permissions, Chrome site access, iframe support,
  installation flow, or release artifacts;
- the issue explicitly asks for standalone Chrome or Power BI validation.

If none of those apply, report manual validation as not required and include the
reason.

## Build and load the extension

1. From the extension repository, run `npm run build`.
2. Open standalone Chrome. Do not use the in-app browser for this validation.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Choose **Load unpacked** and select the generated `dist/` directory.
6. After every rebuild, return to `chrome://extensions`, reload the unpacked
   extension, then refresh or reopen the report page before retesting.
7. When practical, restrict Chrome site access for the extension to the specific
   portal and embedded iframe/report domains used for validation.

If the required private authentication environment is unavailable, stop the
manual portion and report it as blocked with the exact access blocker. Do not
record shared notes that include credential material.

## Validate on an embedded Power BI report

Use a report page that exercises the behavior changed by the task. Embedded
portal pages are preferred when the issue involves frames, custom hosts,
permissions, or site access; direct report pages are acceptable only when they
cover the issue.

Open the relevant report without embedding private URLs in shared notes. Record
a sanitized environment summary instead, such as browser version, operating
system, extension commit, build command used, report type, and whether the
report was direct or embedded.

Confirm the extension popup can reach the report context before running detailed
checks. If the popup cannot detect supported filters, verify that the extension
was reloaded after the build, that Chrome site access includes both the portal
and embedded report frames, and that the report has finished loading.

## DevTools frame and diagnostics

Open DevTools for the report page when manual evidence needs DOM or diagnostic
confirmation. Select the Power BI frame when the report is embedded; the top
page frame often does not contain the slicer DOM.

Use console filtering to keep evidence readable. Filter for `[Power BI Presets]`
messages when investigating content-script activity. Content scripts run in an
isolated world, so page DevTools checks should prefer the diagnostic bridge
exposed through `window.PowerBIFilterPresets` or `PowerBIFilterPresets:*`
CustomEvent handlers only when the task calls for diagnostic validation.

For apply diagnostics, dispatch `PowerBIFilterPresets:applyPreset` with a saved
preset object only in the selected Power BI frame and only when the task needs
that path verified. If the hook is unavailable, first suspect the wrong frame or
an unloaded content script, then reload the unpacked extension and report page
before retesting.

## Save and capture checks

1. Select supported list-filter values in the report.
2. Include values that require scrolling when the changed behavior involves
   virtualized or offscreen options.
3. Open the extension popup and save the current filters.
4. Review the captured filter summary before accepting it.
5. Confirm expected supported filters and selected labels are present.
6. Confirm unrelated controls, unsupported visuals, and unselected values are
   not captured.
7. If export or JSON review is part of the task, inspect the exported data
   locally for expected selected labels, especially offscreen values, but do not
   paste preset JSON into shared notes.

Report any missing or extra captured filter with the report area, expected
value, observed value, and whether the filter was visible, scrolled into view,
or virtualized.

## Apply checks

1. Start in the same report context used to save or prepare the preset.
2. Change or clear the relevant filter values so the apply action has an
   observable effect.
3. Apply the saved preset from the extension popup.
4. Review the per-filter result summary.
5. Confirm the final selected UI values exactly match the preset.
6. Confirm previous extra selections are cleared when the preset expects them to
   be absent.
7. For delayed or virtualized options, confirm the extension either selects the
   expected value after scrolling/waiting or accurately reports the missing
   filter or value.
8. If the report changed since the preset was captured, record expected
   successes separately from missing filters or missing values.

The validation result should distinguish extension failures from legitimate
report drift. A successful apply check requires the final visible Power BI state
to match the preset, not just a successful popup message.

## Release artifact checks

Use these checks when the issue changes packaging, release automation, install
flow, or release documentation.

- ZIP artifact: extract the ZIP, then load the extracted contents as an unpacked
  extension in standalone Chrome. The extracted directory should contain the
  extension files at its root, including `manifest.json`, rather than an extra
  wrapper directory that Chrome cannot load directly.
- CRX artifact: validate only in controlled developer or enterprise flows where
  the environment supports CRX installation. Chrome restrictions vary by policy
  and operating system, so report unsupported local CRX installation as an
  environment limitation rather than a product pass.
- `SHA256SUMS.txt`: verify the checksum file against the release artifacts using
  the repository release verification command or a platform checksum tool, and
  confirm every listed artifact is present.

## Reporting manual validation

Report manual validation using one of these statuses:

- completed: include sanitized environment, commit, artifact or preset file name
  if one was used, steps performed, diagnostic method, DOM evidence summary,
  final selected values, per-filter results, and conclusion;
- blocked: include the environment or access blocker, the automated checks that
  did run, and the manual steps that could not be completed;
- not required: include the reason manual validation was out of scope for the
  change.

Keep the record specific enough for a maintainer to understand what was proven,
but exclude private URLs, authentication examples, raw logs, screenshots, preset
JSON, and local task-tracker or branch-history details.
