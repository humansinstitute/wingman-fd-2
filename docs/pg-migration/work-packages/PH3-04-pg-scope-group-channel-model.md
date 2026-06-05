# PH3-04 PG Scope, Group, Channel Model Alignment

## Working Directory

- `/Users/mini/code/wingmanbefree/wm-fd-2`
- `/Users/mini/code/wingmanbefree/wingman-tower`

## Supporting Docs

- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/architecture.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/scope-group-channel-gap-review.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/design/group-arch.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/design/workspace_admins.md`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/services/flightdeck-pg-api.ts`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/services/flightdeck-pg-authorization.ts`

## Problem

PG mode currently reuses too much encrypted-record scope/group UI. It should preserve Flight Deck layout, but it must not expose group payloads, shares, scope crypto, record repair, or L1-L5 scope hierarchy as the PG product model.

## Required Work

- Add explicit PG-mode UI labels for `Scope -> Channel -> Thread`.
- Hide legacy L2-L5 child-scope creation in PG mode.
- Hide encrypted-record group/shares/crypto controls in PG mode.
- Ensure PG scope display uses `scope.kind` rather than legacy level labels where available.
- Ensure channel display is the normal L2 access boundary in PG mode.
- Ensure `AIAgents` are not shown as structure admins by default.

## Acceptance Tests

- In PG mode, scope settings do not show `Reapply group crypto`, record repair, or encrypted sync actions.
- In PG mode, scope IA is presented as broad scope plus channels, not generic L1-L5 scope nesting.
- Existing encrypted-record mode still shows the old controls.
- `npm run build` passes in `wm-fd-2`.

## Human Verification

Open the PG app-card, connect a PG workspace, and confirm the settings and channel surfaces do not mention encrypted record internals.
