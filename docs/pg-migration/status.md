# Flight Deck PG Classic Migration Status

## Current Status

Planning restored and app-card baseline available. `wm-fd-2` is a clean copy of `wingman-fd` with migration docs, installed dependencies, built static assets, and a running Autopilot app-card instance. PH1-01 established the app-side backend-mode boundary, and PH1-02 now connects that boundary to Tower PG workspace descriptors through the classic Flight Deck connection flow.

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
- Added PH1-02 PG auth/workspace connection wiring in `tower-pg` mode: the classic connect modal now accepts Tower PG workspace descriptors, stores verified descriptor metadata in the existing known-workspaces settings state, and calls Tower PG service, workspace list, descriptor, and `/me` routes with browser NIP-98 auth.
- Added PH1-02 focused coverage for PG descriptor parsing, credential rejection, PG workspace materialization, PG workspace identity merging, and descriptor persistence through the existing connection manager.
- Fixed PG workspace normalization so descriptor-backed workspaces do not generate or persist SuperBased connection tokens.
- Recovered PH1-02 from stalled pipeline run `b1854b43-088e-4eae-9c34-905c7d9d74f6`; retained the useful partial patch, completed tests/build locally, and will continue with one ticket per pipeline where the runner remains healthy.

## Outputs

- Migration plan is ready for pipeline execution.
- App-card baseline is available for pipeline work.
- PG migration product code now has a mode boundary plus descriptor-based Tower PG workspace connection in the existing Flight Deck UI.
- PH1-02 validation: `bun run test -- tests/backend-mode.test.js tests/api-pg-workspaces.test.js tests/pg-workspace-descriptor.test.js tests/workspaces.test.js tests/connect-settings-manager.test.js tests/pg-connect-settings-manager.test.js tests/pg-workspace-manager.test.js`; `bun run build`.
