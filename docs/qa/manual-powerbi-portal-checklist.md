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

1. Select values in supported list filters.
2. Open the extension popup.
3. Click "Save current filters".
4. Name the preset "Manual QA".
5. Confirm the popup reports the number of saved filters.
6. Reload the portal report.
7. Confirm Power BI cleared the filters.
8. Open the extension popup.
9. Select "Manual QA".
10. Click "Apply selected preset".
11. Confirm the expected values are selected again.
12. Confirm the popup reports per-filter results.

## Edge Cases

1. Rename a preset and confirm the new name persists after reopening the popup.
2. Delete a preset and confirm it disappears only for the current URL.
3. Try applying a preset after a filter value is no longer visible in the report.
4. Confirm the popup reports the missing value instead of reporting success.
