# PH3-02 Task Write Adapter

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- Existing task board write paths
- `/Users/mini/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`

## Scope

Route existing task create/update/status actions to Tower PG in PG mode.

## Acceptance

- Create task from existing UI.
- Move/update task from existing UI.
- Channel-level task board writes preserve scope/channel/thread references.
- Commit changes before handoff.
