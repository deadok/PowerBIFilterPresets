# Manual QA Checklist: Corporate Power BI Portal

Use this checklist with a real corporate portal report in Chrome.

## Setup

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select the repository `dist/` folder.
6. Open a corporate portal page that contains an embedded Power BI report.

## Save and Restore

1. Select values in supported list filters. Include an ordinary subset and, if
   available, multiselect slicers in global All and None states.
2. Open the extension popup.
3. Click "Save current filters".
4. Confirm the **All values** and **No values** review rows are unchecked by
   default. Explicitly include the mode rows needed by the preset.
5. Name the preset "Manual QA".
6. Confirm the popup reports the number of saved filters.
7. If inspecting local JSON, confirm each semantic mode uses
   `selectionMode: "all"` or `selectionMode: "none"` with
   `selectedLabels: []`, not a localized "Select all" value.
8. Reload the portal report and change or clear the relevant filters.
9. Enter a slicer search that hides at least one saved value and leave it active.
10. Open the extension popup, select "Manual QA", and click "Apply preset".
11. Confirm the controlled search is cleared and the expected values or the
    **All values** and **No values** states are restored from the full option
    domain.
12. Apply "Manual QA" again without changing the report. Confirm the result is
    still successful and no value is toggled or otherwise changed.
13. Confirm the popup reports accurate per-filter results for both applies.

## Search, locale, and virtualization

1. With a slicer search active, confirm the visible rows are treated as a
   projection. Clear the search before saving a global All or None state.
2. Use a test report whose slicer title and ordinary value labels remain exactly
   the same across the locale switch. Save semantic All/None in one available
   Power BI or Chrome locale, switch to another locale where the "Select all"
   caption is translated, reload, and apply the same preset. Confirm only the
   semantic mode is caption-independent; ordinary titles and labels still use
   exact matching.
3. Use a long virtualized slicer with an offscreen target. Confirm capture and
   apply scan beyond the initially rendered rows.
4. If the report replaces popup/listbox DOM while loading more rows, confirm a
   compatible replacement preserves progress. An incomplete or contradictory
   replacement must fail closed without partial apply.
5. Repeat with delayed option rendering or a visible loader and confirm the
   final state, not only the popup message.

## Edge Cases

1. Rename a preset and confirm the new name persists after reopening the popup.
2. Delete a preset and confirm it disappears only for the current URL.
3. Remove or rename a filter and confirm the popup reports `missing_filter`.
4. Remove a saved value from an otherwise completely scannable filter and
   confirm the popup reports `missing_value` instead of success.
5. Keep a loader or virtualized scan incomplete and confirm the popup reports a
   timeout rather than `missing_value` or success.
6. Confirm an incomplete capture omits the unproven slicer instead of saving a
   partial All/None state.
