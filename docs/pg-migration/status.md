# Flight Deck PG Classic Migration Status

## Current Status

Planning restored and app-card baseline available. `wm-fd-2` is a clean copy of `wingman-fd` with migration docs, installed dependencies, built static assets, and a running Autopilot app-card instance. PH1-01 has started the product migration baseline with an app-side backend-mode boundary.

## Decisions

- Preserve the existing Flight Deck UI.
- Preserve Dexie as local/offline materialized state.
- Replace encrypted record sync with PG backend adapters in PG mode.
- Use Tower PG as source of truth.
- Keep Tower encrypted-record sync backwards compatible.
- Use the experimental `flightdeck-pg` app as API reference/test harness only, not as the product UI target.
- Dogfood with a seeded Wingmen Community PG workspace as soon as read hydration is usable.
- Do not commit generated `ecosystem.config.cjs`; Autopilot app registry owns app-card runtime process config.
- Default `wm-fd-2` to encrypted-record mode until `VITE_FLIGHT_DECK_BACKEND_MODE=tower-pg` or its compact alias is explicitly configured.

## Actions

- Created `docs/pg-migration/implementation.md`.
- Created `docs/pg-migration/architecture.md`.
- Created `docs/pg-migration/wingmen-community-bootstrap.md`.
- Created work packages under `docs/pg-migration/work-packages/`.
- App-card baseline available at `https://near-tea-crab.rick.runwingman.com`.
- Removed the copied PM2 runtime file from source control and ignored it.
- Added PH1-01 backend-mode resolution for `encrypted-records` and `tower-pg`.

## Outputs

- Migration plan is ready for pipeline execution.
- App-card baseline is available for pipeline work.
- PG migration product code now has a mode boundary, while UI behavior remains unchanged.
