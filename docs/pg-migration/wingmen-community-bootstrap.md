# Wingmen Community PG Bootstrap

Create a real Tower PG workspace Pete can use as the first daily dogfood workspace for `wm-fd-2`.

## Workspace

Label: `Wingmen`

Purpose: first practical PG workspace for Pete and wm21 to use while migrating the classic Flight Deck UI.

## Minimum Groups

- Managers
- Admins
- Viewers
- AIAgents

## Initial IA

Scope: `Wingman Suite`

Channels:

- `Flight Deck PG`
- `Tower PG`
- `Implementation`

Each channel should support chat, task board, docs/files, comments, reactions, and thread-level context.

## Seed Users

- Pete: `npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy`
- wm21: `npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz`

## Acceptance

- Tower setup script can create or update the workspace idempotently.
- Descriptor JSON can be imported into `wm-fd-2`.
- Pete can log in with Nostr and see the seeded scope/channel structure.
- wm21 can authenticate through NIP-98 and create test data through `flightdeck-cli`.
