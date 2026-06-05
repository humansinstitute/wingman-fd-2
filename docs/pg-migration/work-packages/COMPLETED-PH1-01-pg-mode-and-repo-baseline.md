# PH1-01 PG Mode And Repo Baseline

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- `docs/pg-migration/implementation.md`
- `/Users/mini/code/wingmanbefree/wingman-fd`

## Scope

Make `wm-fd-2` clearly identify itself as the PG migration copy of Flight Deck and add a backend-mode boundary without changing existing UI behavior.

## Required Work

- Add a small backend-mode module that can resolve `encrypted-records` vs `tower-pg`.
- Default mode must preserve current encrypted-record behavior until explicitly set to PG mode.
- Add tests for mode resolution.
- Keep UI unchanged.

## Acceptance

- Relevant tests pass.
- App still builds with `bun run build`.
- Commit changes before handoff.
