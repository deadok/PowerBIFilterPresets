# Migrated Historical Docs

This directory stores historical local documentation that was inspected and
intentionally moved into the tracked repository.

Do not bulk-import local docs.

## Migration rules

Before adding a historical file:

1. inspect the original file or folder;
2. remove `.DS_Store`, transient logs, and generated output;
3. sanitize credentials, private URLs, screenshots, and preset JSON;
4. remove stale claims that are no longer useful;
5. keep only durable context, decisions, reproduction notes, or validation
   guidance;
6. link the migrated file from a GitHub Issue only when it is relevant.

## Categories

- `tasks/` — migrated bug or task notes.
- `features/` — migrated feature specifications or decisions.
- `decisions/` — durable project decisions that apply beyond one task.

Each migrated item should be a focused file. Do not create a single catch-all
legacy document.
