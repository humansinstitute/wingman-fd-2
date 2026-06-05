# PH5-01 Offline Reconnect And Event Reconcile

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- Existing sync status UI
- Tower PG events endpoint

## Scope

Make offline/reconnect behavior reliable in PG mode.

## Acceptance

- Offline status is visible.
- Reconnect drains pending writes.
- Tower events reconcile Dexie without full reload where possible.
- Commit changes before handoff.
