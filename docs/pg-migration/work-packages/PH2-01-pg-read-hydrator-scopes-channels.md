# PH2-01 PG Read Hydrator Scopes Channels

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/services/flightdeck-pg-api.ts`

## Scope

Hydrate PG scopes, channels, and threads into the existing Dexie-backed navigation models.

## Acceptance

- Seeded Wingmen scope/channel/thread hierarchy renders in the existing UI.
- Channel access grants hide sibling channels that are not granted.
- Existing encrypted mode behavior remains unchanged.
- Commit changes before handoff.
