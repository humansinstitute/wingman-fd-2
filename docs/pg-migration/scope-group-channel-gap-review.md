# Scope, Group, Channel Gap Review

## Current Situation

`wm-fd-2` is using the existing Flight Deck UI and Dexie tables with Tower PG adapters underneath. That is intentional for visual parity, but it means some encrypted-record concepts still leak into PG mode unless explicitly gated.

Tower PG already has the unencrypted primitives needed for the target model:

- `flightdeck_pg_workspaces`
- `flightdeck_pg_actors`
- `flightdeck_pg_groups`
- `flightdeck_pg_group_memberships`
- `flightdeck_pg_group_edges`
- `flightdeck_pg_scopes`
- `flightdeck_pg_channels`
- `flightdeck_pg_permission_grants`
- channel-anchored records for chat, tasks, docs, files, audio notes, comments, and reactions

The app does not yet have the correct PG-native administration model. The missing product surface is workspace setup and access management around:

- workspace members
- groups
- nested groups
- scopes as broad containers
- channels as the normal access boundary
- channel grants for actors or groups
- records inheriting access from channel context

## Target Model

The PG model is:

- Workspace = tenant/backend.
- Scope = broad work area such as business unit, project, department, customer, DM, or custom.
- Channel = primary access boundary and default work surface.
- Thread = focused discussion/work context inside a channel.
- Group = stable composable principal for grants.
- Channel grant = normal way to add a user/group to work.

In PG mode, the legacy scope levels should not be presented as product IA. The effective hierarchy is:

- Scope = L1
- Channel = L2
- Thread = L3

## Immediate Corrections Made

- Hide encrypted-record sync progress and scope-crypto modals in PG mode.
- Hide old record status, pending write, and encrypted sync actions in PG mode.
- Hide scope crypto repair controls in PG mode.
- Tighten default Tower PG permissions so `AIAgents` can work inside granted channels but cannot create scopes or channels by default.

## Remaining Required Work

1. Add Tower PG group/member listing and management routes, or extend `/me` with enough admin metadata to drive the UI.
2. Add `wm-fd-2` PG API client helpers for members, groups, group edges, and channel grants.
3. Replace the old scope-management surface in PG mode with a scope/channel admin surface.
4. Add a channel access panel where admins/managers can add a user or group in a capacity.
5. Make nested groups visible and manageable in PG mode.
6. Make task boards explicitly support scope, channel, and thread zooms without relying on legacy L1-L5 labels.
7. Make all PG record creation infer scope from selected channel and optional thread.

Until these are done, the backend is PG but the access-management UX is incomplete.
