# PH1-04 Wingmen Community Bootstrap

## Workdir

Primary: `/Users/mini/code/wingmanbefree/wingman-tower`

Secondary test client: `/Users/mini/code/wingmanbefree/flightdeck-cli`

## Supporting Docs

- `docs/pg-migration/wingmen-community-bootstrap.md`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/scripts/setup-flightdeck-pg-workspace.ts`
- `/Users/mini/code/wingmanbefree/flightdeck-pg/implementation`

## Scope

Seed a real Tower PG workspace for dogfooding `wm-fd-2`.

## Required Work

- Create or update a setup script for the Wingmen workspace.
- Bootstrap minimum groups: Managers, Admins, Viewers, AIAgents.
- Seed scope `Wingman Suite` and initial channels.
- Add Pete and wm21 grants.
- Output descriptor JSON suitable for import into `wm-fd-2`.

## Acceptance

- Script is idempotent.
- Descriptor can be used by `wm-fd-2`.
- `flightdeck-cli` can create/read a minimal test record.
- Commit changes before handoff.
