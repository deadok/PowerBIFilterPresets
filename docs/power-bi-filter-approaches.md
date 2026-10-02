# Power BI Filter Approaches

## Purpose

This document is the maintained technical reference for discovering, saving, and
applying supported embedded Power BI list filters in Power BI Filter Presets. It
records the product assumptions that should guide future maintenance, bug fixes,
and validation.

The extension works with local presets scoped to a normalized page URL. A preset
captures supported filter names and either selected list values or a proven
semantic global All/None state from the active page/report context, then applies
that state back to matching controls later.

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

## Preset selection state model

Ordinary subset selection is stored in `selectedLabels`. A global multiselect
state is stored semantically and must not depend on Power BI's localized
"Select all" row:

- global All: `selectionMode: "all"` and `selectedLabels: []`;
- global None: `selectionMode: "none"` and `selectedLabels: []`.

`selectionMode` and non-empty `selectedLabels` are mutually exclusive. This
keeps semantic All/None application independent of the translated "Select all"
caption and prevents that display label from becoming preset data. Ordinary
filter titles and value labels still require exact matches. In save review, the
**All values** and **No values** rows are deliberately excluded (unchecked) by
default. The user must explicitly include such a row when the global mode
belongs in the preset.

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
list filters, identifies selected values or a proven semantic global All/None
state for each filter, and presents a save review before storing the preset
locally for the normalized page URL.

Capture needs to handle selected values that are visible, offscreen, or
summarized by the Power BI UI, as well as semantic global modes. DOM capture
remains primary, but available Power BI JS API slicer state can supplement DOM
results and merge validated selected
labels when virtualized or offscreen selections are missed. API state enriches
only filters already keyed by a DOM-backed title; API-only slicers are not
appended because their title cannot yet be associated safely with the captured
DOM control. When a dropdown or
slicer must be opened to inspect option rows, selected labels should be
snapshotted before opening a different slicer because opening another control
can remove or replace popup DOM. Existing external popup DOM may also be stale,
so capture may need to force-open and rescan before trusting it.

Capture must avoid unrelated controls. It should save supported list filter
state only when it can associate a filter title with real selected labels from
option rows or validated Power BI slicer state, or with complete full-domain
proof of a semantic global mode. Generic summaries, unrelated buttons, visual
labels, or portal navigation controls should not become preset data.

An active slicer search is a projection of the option domain, not evidence about
the unfiltered global state. Clear the search before capturing global All or
None. Capture must not infer `selectionMode` from a searched or changing
projection; it may still retain ordinary selected labels that are known from a
valid full-domain scan. When a correctly controlled visible dropdown has a
nonblank search, capture snapshots the exact query, temporarily clears it, and
notifies the host with input, change, and keyup events. Updating the DOM input
alone does not commit Power BI's debounced application search. Capture waits for
an attributable clear response before starting bounded traversal from the
correctly controlled post-clear viewport, even when no loader appears. The
top rows may remain unchanged while a loader settles and the scroll geometry or
authoritative domain size expands. Transition proof is therefore collected at
the original top/rest position before traversal, while scanning may continue
afterward. Viewport churn caused by scrolling cannot establish proof. Capture
suspends the first traversal attempt while a scoped loader triggered by the
clear is visible, so a loader-settled top/rest transition can be observed. A
traversal attempt begins before dispatching a native scroll, wheel event, or
custom-scrollbar drag; it does not depend on `scrollTop` changing. Therefore
rows swapped by an event handler while `scrollTop` remains zero cannot establish
proof. Capture succeeds only when the scan completes and an attributable pre-scroll
semantic/logical-domain or geometry transition was observed, then restores the exact
query while allowing Power BI to render the searched projection again. Capture
records that query per controlled slicer before reading any slicer, so a popup
destroyed while an earlier slicer is inspected can still be restored exactly
after the target is reopened. Restoration is verified against the currently
controlled input and searched projection after rendering, and retried if Power
BI replaces the input. A top-position projection must match the original
normalized labels and logical metadata; an originally scrolled projection may
return at the top only after an attributable change with the same authoritative
domain size and scroll extent. Stable input text by itself is not restoration.
The fact that a search was active remains sticky provenance throughout capture, so
the resulting state is always ordinary `selectedLabels`, never
`selectionMode`. A selected `aria-setsize="1"` row with position 1 and a stable
identity is not proof that a previous search projection contained the full
selection. A coherent change in the normalized label multiset or aggregate
validated logical coverage (expected sizes and positions, compared independently
from labels) must show that Power BI rendered the cleared domain.
Replacing the listbox element or regenerating stable row IDs does not count if
that semantic/logical projection is unchanged. Reordering identical labels and
reassigning their positions also does not count. An unchanged one-row or multirow
projection is omitted even if its input value was cleared. A title-matched
external popup with an active search but no authoritative `aria-controls`
ownership is also omitted.
All capture paths require visible options, including dropdowns without a search.
A connected hidden popup may retain an obsolete viewport and later prune it to
its Select all row. Capture reopens the owned dropdown and scans its visible
current domain instead of treating that hidden snapshot as ready. Selected
evidence observed while a control was originally visible can still be retained
under the existing consistency checks.
Power BI can briefly mix a searched row with complete logical metadata and
another row whose own `aria-setsize` is invalid or unknown. Logical position
and size evidence is parsed atomically per row: the incomplete row can provide
a provisional selected label, but it cannot create a position conflict using a
different row's size. The whole mixed batch remains provisional and cannot
complete logical coverage. The first coherent full-domain generation starts a
new epoch and clears every provisional label before its rows are accepted. A
scan reset before clear-response proof and before traversal only clears
provisional evidence; a later coherent full-domain generation may still prove
the capture. If a reset occurs after transition
proof or after traversal begins, the proof is invalidated and that capture is
omitted. Later rows in the same scan cannot reauthorize it or be combined with
the earlier generation.
If the unfiltered scan, loader settling, or query restoration cannot complete,
capture omits the slicer rather than saving the projection alone. An otherwise
ambiguous no-search single-row multiselect remains fail-closed. The absolute
capture deadline is 9000 ms per slicer, created
once and shared by option resolution, an optional forced reopen, and the scan.
It includes query restoration and is not a separate 9000 ms allowance for each
phase. Capture reserves 700 ms for the keyup-driven restore response, including
50 ms of stable, loader-free rendered evidence. This reserve applies even when
the retained query is discovered only after opening a closed popup. It does not
extend the deadline. If a complete,
authoritative capture cannot be proven before that deadline, omit that slicer
from the captured preset rather than store partial or contradictory state.
The larger finite capture window accommodates remote domains that grow as
scrolling loads additional pages (the observed Queue domain reaches 399 rows).
Incomplete or inconsistent captures emit a console warning containing the
slicer title and configured capture budget; this diagnostic does not claim
every omission is a timeout and does not include selected values or report URLs.

Virtualized traversal allows up to 300 ms after each wheel or scroll move for
the rendered snapshot to change. A physical scan is complete only after at
least 700 ms of unchanged, loader-free snapshots following the last observed
change. These waits remain bounded by the absolute 9000 ms capture
deadline or the shared 9000 ms apply deadline; they do not create fresh
per-step budgets.

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

Applying a dropdown or slicer clears its controlled search before discovery so
preflight, mutation, and verification operate on the full option domain. A
semantic All/None mode is applied structurally without depending on the
translated "Select all" caption. Ordinary filter titles and value labels still
require exact matches. The absolute apply deadline is 9000 ms per filter,
created once and shared by resolution, search clearing, discovery, mutation,
verification, and wheel or scrollbar fallbacks. No phase receives a fresh 9000
ms budget.

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

Capture and apply have intentionally different incomplete-state semantics. An
unproven slicer is omitted during capture. During apply, `missing_filter` means
that no matching filter exists, while `missing_value` is valid only
after the full relevant option domain was proven and a requested value was not
present. Delayed, incomplete, contradictory, or unbounded discovery must return
`timeout`, not `missing_value` and never `applied`.

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

Virtualized rows can be replaced while a scan is in progress. Preserve logical
progress and the forward scroll frontier only across compatible row generations
with authoritative identity/position evidence. Monotonic `aria-setsize` growth
extends the expected domain; complete coverage requires every logical position.
When a replacement reuses positions for different identities, a stated batch is
partially identifiable, or one batch assigns conflicting identities to the same
position, reset the epoch and quarantine unprovable rows from caller evidence.
A later clean generation may re-prove the full domain. Otherwise fail closed:
do not union old and new evidence, mutate from partial proof, or convert an
incomplete scan into a missing value.

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
