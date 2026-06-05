# PH3-05 PG Workspace Admin Groups

## Working Directory

- `/Users/mini/code/wingmanbefree/wingman-tower`
- `/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/architecture.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/scope-group-channel-gap-review.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/design/workspace_admins.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/design/group-arch.md`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/schema/ensure-runtime-schema.ts`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/services/flightdeck-pg-authorization.ts`

## Problem

Tower PG has group tables, group memberships, nested group edges, and effective group authorization, but `wm-fd-2` does not expose a PG-native workspace admin UI for them.

## Required Work

- Add Tower PG routes to list groups, list members, create groups, add/remove group members, and add/remove nested group edges.
- Gate these routes with workspace/admin-manager permissions according to the design docs.
- Add `wm-fd-2` API helpers for the new routes.
- Add a PG workspace admin panel for:
  - members
  - groups
  - group members
  - group-in-group relationships
  - effective member preview

## Acceptance Tests

- Admin can create a group and add an existing workspace member.
- Admin can nest one group inside another.
- Effective group expansion includes nested groups.
- Non-admin/non-manager cannot mutate group structure.
- Tower tests cover direct and nested membership.
- `wm-fd-2` build passes.

## Human Verification

Pete can add a user npub, put the user in a group, nest that group under another group, and see the effective access before granting a channel.
