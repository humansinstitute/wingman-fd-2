# PH1-02 PG Auth And Workspace Connection

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- `/Users/mini/code/wingmanbefree/flightdeck-pg`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`

## Scope

Wire the existing Flight Deck Nostr login shell to Tower PG workspace descriptors.

## Required Work

- Preserve existing Nostr login/avatar menu flow.
- Accept a workspace locator descriptor.
- Store the descriptor locally for reload.
- Call Tower PG `descriptor` and `me` routes using browser NIP-98.
- Surface connection errors in the existing workspace UI style.

## Acceptance

- A descriptor can be pasted once and survives reload.
- Authenticated user can call Tower PG `me`.
- Unauthenticated requests do not attempt PG writes.
- Commit changes before handoff.
