# PH3-06 PG Channel Grants UI

## Working Directory

- `/Users/mini/code/wingmanbefree/wm-fd-2`
- `/Users/mini/code/wingmanbefree/wingman-tower`

## Supporting Docs

- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/architecture.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/scope-group-channel-gap-review.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/design/workspace_admins.md`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/services/flightdeck-pg-api.ts`

## Problem

Channel grants are the normal PG access boundary, but the app does not yet let admins add a user or group to a channel in a clear capacity.

## Required Work

- Add or complete `wm-fd-2` API helpers for:
  - `GET /api/v4/flightdeck-pg/workspaces/:workspaceId/channels/:channelId/grants`
  - `POST /api/v4/flightdeck-pg/workspaces/:workspaceId/channels/:channelId/grants`
- Add a channel access panel to channel settings.
- Let admins/managers grant actor or group access using capacity presets:
  - viewer
  - contributor
  - manager
  - agent
- Map capacities to explicit Tower permissions.
- Refresh PG scopes/channels/tasks/messages after grant changes.

## Acceptance Tests

- Adding a user to a channel makes the parent scope and that channel visible to them.
- The user does not see sibling channels.
- Adding a group to a channel gives access to direct and nested group members.
- Viewer can read but not write.
- Agent can create task/chat/doc/file/audio records where granted but cannot manage workspace structure.

## Human Verification

Pete can add a person or group to the Marketing Website channel, then confirm that the person sees Marketing and Website but not Marketing Blogs.
