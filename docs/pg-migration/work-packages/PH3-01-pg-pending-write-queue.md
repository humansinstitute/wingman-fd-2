# PH3-01 PG Pending Write Queue

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- Existing Dexie write paths under `src/`

## Scope

Add a PG-mode pending write queue that lets the existing UI remain optimistic/offline-capable while Tower PG remains source of truth.

## Acceptance

- Offline writes queue locally.
- Reconnect attempts submit queued writes with NIP-98.
- Successful writes reconcile from Tower response/events.
- Commit changes before handoff.
