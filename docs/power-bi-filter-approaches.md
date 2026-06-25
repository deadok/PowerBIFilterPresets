# Power BI Filter Approaches

## Purpose

This document is the maintained technical reference for discovering, saving, and
applying supported embedded Power BI list filters in Power BI Filter Presets. It
records the product assumptions that should guide future maintenance, bug fixes,
and validation.

The extension works with local presets scoped to a normalized page URL. A preset
captures supported filter names and selected list values from the active
page/report context, then applies those values back to matching controls later.

This is not a claim that every Power BI visual or filter type is supported.
Maintain the distinction between supported list-style filters and unrelated
Power BI controls, visuals, or report interactions.

## Supported scope

The supported scope is embedded Power BI reports that expose list-style filters
or slicers through the report DOM, with DOM capture as the primary source of
filter state. When available, the extension can use Power BI JS API slicer state
as a supplemental source for selected labels. The current approach is intended
for both standard Power BI surfaces and custom or corporate portals that host
Power BI content.

Capture should target the best available report frame. A direct Power BI page
may expose the relevant DOM in frame 0, while embedded portal pages commonly
place the report inside a Power BI iframe or nested frame. The extension uses
broad host and frame coverage so content scripts can reach those contexts,
including `all_frames` behavior and non-standard portal hosts.

Supported controls include checkbox cards and list/dropdown slicers where real
option rows can be identified. Title resolution should prefer a visible header
and then fall back to ARIA labels. Saved selected labels should come from the
actual option rows or validated Power BI slicer state, not from generic
summaries such as "Multiple selections".

## Embedded report constraints

Embedded reports are not a stable static page. Reports can run inside iframes or
nested frames, portal hosts can be outside standard Power BI domains, and the
Power BI DOM can change without notice. Discovery code should therefore inspect
the real DOM in the active context instead of assuming a fixed document shape.

The broad manifest host and frame scope is part of the product support model for
custom and corporate portals. Preserve that scope unless an explicit GitHub
issue changes the product scope and includes a standalone Chrome validation
plan.

Avoid coupling support to private portal URLs, tenant-specific page structures,
or screenshots from one environment. A useful implementation should work from
observable report controls and frame contents.

## Save and capture approach

Saving starts from the active page/report context. Capture discovers supported
list filters, identifies the selected values for each filter, and presents a
save review before storing the preset locally for the normalized page URL.

Capture needs to handle selected values that are visible, offscreen, or
summarized by the Power BI UI. DOM capture remains primary, but available Power
BI JS API slicer state can supplement DOM results and merge validated selected
labels when virtualized or offscreen selections are missed. When a dropdown or
slicer must be opened to inspect option rows, selected labels should be
snapshotted before opening a different slicer because opening another control
can remove or replace popup DOM. Existing external popup DOM may also be stale,
so capture may need to force-open and rescan before trusting it.

Capture must avoid unrelated controls. It should save supported list filter
state only when it can associate a filter title with real selected labels from
option rows or validated Power BI slicer state. Generic summaries, unrelated
buttons, visual labels, or portal navigation controls should not become preset
data.

## Apply approach

Applying a preset should use a discovery pass followed by an apply pass. The
discovery pass finds candidate controls and resolves each saved filter name to
exactly one supported control. If no matching control exists, report
`missing_filter`. If multiple plausible controls match, report
`ambiguous_filter` rather than mutating an arbitrary control.

Before mutation, verify labels against real option rows. The apply pass should
clear undesired values, select desired values, and verify the final option state
where possible. It should use robust pointer and mouse interactions for opening
controls, wait for real option rows, and treat a list containing only "Select
all" as not ready.

Per-filter results should distinguish successful application from missing
filters, missing values, interaction failures, and timeouts. The maintained
statuses are:

- `applied`
- `missing_filter`
- `ambiguous_filter`
- `missing_value`
- `timeout`
- `interaction_failed`

Report changes can legitimately cause missing results. For example, a renamed
filter should become a missing filter, and a removed or renamed option should
become a missing value. Interaction failures and timeouts should stay distinct
from missing values so maintainers can tell a report content change from a DOM
readiness or automation problem.

Always close dropdowns after apply or error handling when possible. Avoid
unrelated mutation: do not click through portal controls, unrelated report
visuals, or ambiguous filters just to make progress.

## Dropdown and virtualization constraints

Dropdown slicers can render their option popups outside the filter root, so code
must not limit option discovery to descendants of the visible slicer container.
External popup DOM can be stale, and dropdown readiness can be delayed. Wait for
real option rows before deciding that values are present or absent.

Long option lists may be virtualized, meaning only the currently visible slice
exists in the DOM. Scanning may need to scroll through the list to find offscreen
values. Prefer normal `scrollTop` movement when it works, use bounded wheel
fallbacks when it does not, and support custom scrollbar dragging where needed.
Stop after repeated unchanged slices to avoid infinite scans.

Timeouts during dropdown opening, readiness waiting, scrolling, or option search
should be reported as timeouts. Do not convert a timeout into a false
`missing_value`, because that hides the difference between an absent report value
and a value that might exist beyond a delayed or virtualized list.

## Design cautions for future work

Future changes should inspect real Power BI DOM behavior before changing the
capture or apply model. Add or update tests for visible, offscreen, delayed, and
virtualized options whenever those paths are touched.

Preserve broad manifest host and frame support unless a GitHub issue explicitly
narrows product scope and includes standalone Chrome validation. The extension
is expected to support embedded Power BI reports in custom and corporate
portals, not only standard Power BI domains.

Keep manual validation steps current with implementation behavior. Validation
should cover saving selected list values, applying them after reload, reporting
missing filters and missing values, and surfacing interaction failures or
timeouts without unrelated report or portal mutation.
