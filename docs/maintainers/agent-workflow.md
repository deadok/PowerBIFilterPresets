# Agent Workflow

This project uses agents as coordinated maintainers, not autonomous product
owners. Agents execute the task that was assigned, preserve unrelated state, and
report evidence.

## Roles

Main agent:

- performs intake;
- checks repository state;
- reads the active issue and linked docs;
- delegates bounded work when useful;
- reviews returned evidence;
- reports status to the user.

Task agent:

- owns one assigned issue or task cycle;
- performs detailed inspection and implementation;
- may spawn worker agents for narrow subtasks;
- runs appropriate verification;
- reports changed files, evidence, risks, and blockers.

Worker agent:

- performs one bounded action such as source inspection, implementation,
  validation, or review;
- returns concrete evidence;
- does not own the whole task.

## Required preflight

Before implementation work, run from the repository root:

```bash
git status --short --branch
git branch -vv
git log -5 --oneline --decorate
git fetch origin
```

If `git fetch origin` fails because of network restrictions, request the
required approval and rerun it.

## Branch rules

- Start feature, bug, release, and process-documentation work from current
  `main`.
- Fast-forward local `main` from `origin/main` before creating a task branch.
- Create a dedicated branch for each implementation task.
- Use descriptive branch names such as:
  - `feat/<short-description>`
  - `fix/<short-description>`
  - `docs/<short-description>`
  - `release/vX.Y.Z`
- Do not reuse a branch for unrelated issues.

## Reading rules

Read narrowly:

1. `docs/maintainers/README.md`
2. this file
3. the active GitHub Issue
4. docs and artifacts linked from the issue

Do not read the entire repository or all historical docs by default.

## Implementation rules

- Use the issue body as the authoritative task specification.
- If the issue is ambiguous, stop and ask for direction.
- Do not infer product scope from old local notes.
- Preserve unrelated changes.
- Preserve untracked `.superpowers/` and `docs/superpowers/`.
- Use `apply_patch` for manual edits.
- Do not narrow the extension manifest host/frame scope unless the issue
  explicitly changes product scope and standalone Chrome validation is planned.

## Approval gates

Do not perform these actions without explicit approval:

- commit;
- push;
- open or update a pull request;
- merge;
- close an issue;
- resolve a review thread;
- tag;
- create or publish a release.

## Reporting

Report:

- branch name;
- changed files;
- verification commands and outcomes;
- manual validation status;
- blockers or risks;
- actions not performed because approval was not granted.

Do not report expected verification as if it ran. State only actual evidence.
