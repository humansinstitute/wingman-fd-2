# Flight Deck PG Classic Architecture

`wm-fd-2` keeps the existing Flight Deck frontend and Dexie services. It does not continue the separate React `flightdeck-pg` UI as the main product path.

## Goal

Port the existing Flight Deck UI and feature set onto Tower Postgres while preserving:

- Nostr login flow and avatar/account menu behavior.
- Existing chat, task board, docs, files, comments, reactions, threads, channels, and scopes UI.
- Dexie as local materialized/offline state.
- Existing schemas and translator semantics wherever possible.

## Backend Boundary

Tower remains backwards compatible. Encrypted record sync stays available for `wingman-fd`; `wm-fd-2` adds a PG backend mode using typed Tower routes under `/api/v4/flightdeck-pg`.

The browser signs requests with NIP-98. Tower verifies the actor, resolves workspace membership, enforces scope/channel ACLs in the TypeScript service layer, validates payloads, and writes Postgres. We are not using Postgres RLS for this slice.

## Local State

Dexie remains the UI store. In PG mode:

- Tower PG is source of truth.
- Hydrators read Tower PG and write Dexie.
- Local pending writes may queue while offline.
- Successful writes reconcile back into Dexie from Tower response/events.
- Legacy encrypted record sync must be disabled in PG mode so the two backends do not compete.

## Workspace And Scope Model

Everything starts in a scope. Scope/channel/thread are the shared IA for chat, task boards, docs, files, audio notes, comments, and reactions:

- Scope = broad project, business unit, or DM container.
- Channel = focused working area and default task-board boundary.
- Thread = specific discussion or work item context.

Access normally grants at channel level, either by direct user grant or group grant. A user who can see a channel can see its parent scope label and scoped records below that channel, but not sibling channels unless granted.

## Records In Scope

Implement these record families for the PG migration:

- tasks
- chat messages
- docs
- files
- audio notes
- threads
- channels
- comments
- reactions

Ignore these families for this migration unless later requested: people, opportunities, organisations, flows, directories, schedules.
