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

1. Select supported list-filter values in the report. Include an ordinary
   subset and, when available, multiselect slicers in global All and None states.
2. Include values that require scrolling when the changed behavior involves
   virtualized or offscreen options.
3. If a slicer search is active, first record the searched projection. Clear
   the search before capturing a global All or None state; a search projection
   is not proof of the full-domain state. Also test a search that leaves one
   selected result visible while other values remain selected outside the
   projection: capture must temporarily clear the search, complete a scan of
   the unfiltered domain, retain every selected label without `selectionMode`,
   and restore the exact query. Repeat when another slicer is scanned first and
   Power BI replaces the popup DOM. If the unfiltered domain remains incomplete
   or loading, the slicer must be omitted and the query must still be restored.
   Also verify restoration when the target popup is destroyed by scanning an
   earlier slicer and when Power BI replaces the search input during restore.
   Include `cma`, `CMA`, a broad `C` query, and a no-match query with a pinned
   selected row, with the dropdown both open and closed. Verify the actual
   rendered projection after clearing and restoring, not just the input text.
   Power BI may debounce these keyup-driven responses without a visible loader;
   exercise a roughly 650 ms clear and 550 ms restore, including a virtualized
   domain exceeding 100 rows with selections outside the search results.
   If clearing the input initially leaves the same singleton or multirow top
   viewport, capture must wait before traversal; proof must come from a
   semantic/logical-domain or scroll-geometry change observed at the original
   top/rest position before traversal. Rows revealed only after scrolling cannot
   establish that clearing took effect. Omit the slicer if no attributable change
   appears before the deadline. Replacing the listbox or changing
   only row IDs is not sufficient proof; neither is reordering the same label
   multiset while reassigning positions. Include an already-scrollable searched
   projection where clearing shows a scoped loader: capture must wait for that
   loader to settle before its first traversal attempt. Treat native scroll,
   wheel, and custom-scrollbar actions as traversal even when `scrollTop` stays
   zero; rows swapped by those actions are not clear-response proof. A merely
   title-matched popup without
   `aria-controls` ownership must not be captured. If an incompatible logical
   generation makes the scan restart before proof or traversal, discard the
   provisional rows and require a coherent full-domain generation. A row with
   invalid or unknown `aria-setsize` must not conflict with another row's
   logical position merely because that other row has a valid size. The mixed
   batch must remain incomplete, and the first clean generation must clear all
   of its provisional labels; confirm a selected provisional label absent from
   the clean domain is not saved. If the
   restart occurs after clear-response proof or traversal, omit the slicer and
   restore its query; do not combine or reauthorize evidence across the restart.
   Also capture with Team open and no search while Queue is inspected first.
   If opening Queue closes Team and its hidden rows shrink (for example, from
   14 of 24 rows to only Select all), Team must reopen and scan all 24 live rows.
   A hidden snapshot must neither suppress the filter nor supply stale values.
4. Open the extension popup and save the current filters.
5. Review the captured filter summary before accepting it. Confirm the **All
   values** and **No values** rows are present but unchecked by default, then
   explicitly include the mode rows required by the test preset.
6. Confirm expected supported filters and selected labels are present.
7. Confirm unrelated controls, unsupported visuals, unselected values, and
   values visible only in an invalid or conflicting DOM snapshot are not
   captured.
8. If export or JSON review is part of the task, inspect the exported data
   locally for expected selected labels, especially offscreen values, but do not
   paste preset JSON into shared notes.

For a semantic multiselect state, confirm the local JSON contains
`selectionMode: "all"` or `selectionMode: "none"` with `selectedLabels: []`.
Do not accept a localized "Select all" display string as the saved value.

Report any missing or extra captured filter with the report area, expected
value, observed value, and whether the filter was visible, scrolled into view,
or virtualized.

## Apply checks

1. Start in the same report context used to save or prepare the preset.
2. Change or clear the relevant filter values so the apply action has an
   observable effect.
3. Enter and retain a slicer search that hides at least one saved or deselected
   value. Apply the saved preset from the extension popup and confirm the
   controlled search is cleared and the full domain is used.
4. Review the per-filter result summary.
5. Confirm the final selected UI values exactly match the preset, including the
   **All values** and **No values** states.
6. Confirm previous extra selections are cleared when the preset expects them to
   be absent.
7. For delayed or virtualized options, exercise an offscreen target and, when
   possible, a popup/listbox replacement while scanning. Confirm logical
   progress is preserved for compatible replacements and contradictory or
   incomplete generations fail closed without partial mutation.
8. Apply the same preset a second time without changing the report. Confirm the
   result remains successful, the final state is unchanged, and no values are
   toggled off or otherwise duplicated.
9. If the report changed since the preset was captured, record expected
   successes separately from missing filters or missing values.

For cross-locale validation, use a test report whose slicer title and ordinary
value labels remain exactly the same across the locale switch. Save semantic
All/None modes in one Power BI/Chrome locale, switch to another locale where the
"Select all" caption is translated, reload the report, and apply the same
preset. Only the semantic mode is caption-independent; ordinary filter titles
and value labels still require exact matches.

## Timing and result semantics

Capture uses one absolute 9000 ms deadline per slicer across resolution,
optional reopen, scanning, and verified search restoration. Restoration retries
remain inside that same deadline. Active-search capture reserves 700 ms for
restoration and checks 50 ms of stable, loader-free searched projection after
the host response; it does not accept input text alone. Confirm the reserve is
also respected when the query is discovered only after opening a closed popup.
Exercise a remote domain growing through 101, 200, 299, and 399 rows over more
than three seconds, with a selection on the last page. Capture must include
that selection after complete coverage and settling. If paging remains pending
beyond the 8300 ms work window, capture must omit the slicer, restore its query
within the 9000 ms total, and issue an incomplete-capture console warning.
Apply uses one absolute 9000 ms deadline per
filter across resolution, search clearing, discovery, mutation, verification,
and fallbacks. Validate the combined operation rather than treating these as
fresh per-phase waits.

During virtualized scanning, each wheel or scroll move allows up to 300 ms for
the rendered snapshot to change. Completion requires at least 700 ms of
unchanged, loader-free snapshots after the last observed change; both waits are
bounded by the 9000 ms capture deadline or the shared 9000 ms apply
deadline.

Use separate scenarios to verify result semantics:

- an unproven or incomplete slicer is omitted from capture;
- a renamed/removed filter produces `missing_filter`;
- a requested value absent from a completely scanned domain produces
  `missing_value`;
- a loader, virtualized list, replacement generation, or fallback that cannot
  prove the complete domain before the deadline produces `timeout`, not
  `missing_value` or success.

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
