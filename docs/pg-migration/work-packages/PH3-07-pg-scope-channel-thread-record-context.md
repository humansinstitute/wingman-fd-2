# PH3-07 PG Scope, Channel, Thread Record Context

## Working Directory

- `/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/architecture.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/scope-group-channel-gap-review.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/pg-migration/wingmen-community-bootstrap.md`

## Problem

Records in PG mode should inherit their scope from the current channel, and optionally a thread. The old UI still lets several flows reason about generic scopes directly, which is not the intended PG model.

## Required Work

- Make PG task creation default to selected channel and selected thread where relevant.
- Make PG doc/file/audio creation default to selected channel and selected thread where relevant.
- Add task board zoom modes:
  - scope
  - channel
  - thread
- Make channel board the default from chat.
- Prevent PG mode from independently assigning mismatched scope/channel combinations.

## Acceptance Tests

- Creating a task from a channel writes `scope_id` from the channel and `channel_id` to Tower PG.
- Creating a task from a thread writes `thread_id`.
- Scope board shows all accessible channel tasks in the scope.
- Channel board shows only that channel.
- Thread board shows only that thread.
- `npm run build` passes.

## Human Verification

Pete can open a channel, create a thread, create a task from that thread, and see it at thread, channel, and scope zoom levels.
