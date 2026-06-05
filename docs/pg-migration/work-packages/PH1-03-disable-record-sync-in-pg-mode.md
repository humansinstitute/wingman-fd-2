# PH1-03 Disable Record Sync In PG Mode

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- `src/sync-manager.js`
- `src/worker/sync-worker.js`

## Scope

Prevent encrypted-record sync from competing with Tower PG when PG mode is active.

## Required Work

- Gate existing encrypted sync startup by backend mode.
- Leave encrypted sync untouched for default/original mode.
- Show clear status text when PG mode is active and encrypted sync is intentionally disabled.

## Acceptance

- Original encrypted-record mode still syncs.
- PG mode does not start encrypted record sync.
- Tests or a smoke script prove both branches.
- Commit changes before handoff.
