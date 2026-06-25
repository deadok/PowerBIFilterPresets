# GitHub Issues Workflow

GitHub Issues are the live task tracker for Power BI Filter Presets.

## Issue authority

The issue body is the task contract. If an issue conflicts with old local docs
or migrated historical notes, the issue wins.

Use issue comments to clarify scope. Do not silently expand scope based on
older notes.

## Normal lifecycle

1. Maintainer creates an issue using an issue template.
2. Maintainer applies type, priority, status, agent, and validation labels.
3. Work starts only when the issue is assigned by explicit user direction or
   has the expected approval label for agent work.
4. Agent creates a dedicated branch.
5. Agent implements the issue scope.
6. Agent verifies and reports evidence.
7. Agent opens or updates a PR only after approval.
8. Maintainer reviews and decides whether to merge or request changes.
9. Issue is closed only after explicit approval or normal GitHub PR linkage
   closes it through an approved merge.

## Labels

Type labels:

- `type:bug` — user-visible defect or regression.
- `type:feature` — user-facing capability.
- `type:task` — technical, documentation, or code-health task.
- `type:release` — release preparation or publication.

Priority labels:

- `priority:p0` — urgent release/blocking issue.
- `priority:p1` — important current-cycle work.
- `priority:p2` — normal priority.
- `priority:p3` — low priority or backlog.

Status labels:

- `status:ready` — sufficiently specified and ready to start.
- `status:in-progress` — actively being worked.
- `status:blocked` — waiting for user input or external state.
- `status:needs-review` — implementation or documentation is ready for review.

Agent labels:

- `agent:approved` — agents may start when asked to pick up ready issues.
- `agent:needs-direction` — agents must stop and ask before continuing.

Validation labels:

- `validation:manual-required` — done criteria include standalone Chrome,
  Power BI, or other manual validation.

## Issue selection

When asked to pick work from GitHub Issues:

1. prefer `status:ready` issues;
2. require `agent:approved` unless the user directly assigns the issue;
3. order by priority from `priority:p0` to `priority:p3`;
4. work on one top-level issue at a time;
5. ask for direction if labels and issue body disagree.

## Pull requests

One PR should normally address one issue.

PR descriptions should include:

- linked issue;
- summary of changes;
- validation evidence;
- manual validation status when applicable;
- known risks or follow-up work.

Do not merge a PR unless explicitly approved.
