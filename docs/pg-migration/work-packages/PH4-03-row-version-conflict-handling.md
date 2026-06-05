# PH4-03 Row Version Conflict Handling

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- Tower stale row-version behavior in `/Users/mini/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`

## Scope

Add clear stale-write handling for PG mode.

## Acceptance

- Stale writes show a useful UI state instead of silent failure.
- Refresh/retry path reloads Tower source of truth.
- Tests cover row-version mismatch handling.
- Commit changes before handoff.
