# Maintainer Workflow

This directory is maintainer-only project documentation. It defines how
maintainers and agents coordinate work for Power BI Filter Presets.

Public user-facing information belongs in the repository root `README.md`.

## Source of truth

Live task state lives in GitHub Issues.

Use this priority order when sources conflict:

1. explicit user direction in the current conversation;
2. the GitHub Issue body and comments for the active task;
3. tracked maintainer docs in this directory;
4. linked historical or migrated docs;
5. implementation details in the repository.

The old local coordination files outside the repository are historical source
material only. They are not the live task tracker.

## Start here

For normal task work, read only:

1. this file;
2. `agent-workflow.md`;
3. the active GitHub Issue;
4. documents explicitly linked from that issue.

Do not read the entire repository or all historical docs by default.

## Maintainer docs

- `agent-workflow.md` — how agents start, delegate, branch, verify, and stop.
- `github-issues.md` — issue lifecycle, labels, and PR expectations.
- `validation.md` — required evidence by task type.
- `releases.md` — release process for maintainers.
- `migrated/` — inspected historical docs that were intentionally moved into
  the tracked repository.

## Core rules

- GitHub Issues are the normal source of work.
- The issue body is the task contract.
- Preserve unrelated user changes.
- Preserve untracked `.superpowers/` and `docs/superpowers/`.
- Do not commit, push, open pull requests, merge, close issues, tag, release,
  or publish unless explicitly approved.
- Report actual verification evidence only.
