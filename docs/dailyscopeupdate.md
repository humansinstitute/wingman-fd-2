# Daily Scope Update - Flight Deck Tickets

## Product Decision

Daily Scope is the personal top half of the Autopilot overview. The lower panels remain scoped to the currently selected scope/channel, but Daily Scope and My Agents are about the signed-in human and their explicitly enabled agents.

Canonical behavior:

- one active Daily Scope per person, workspace, and date
- Daily Scope does not change when the user switches scope
- content is a checklist of up to five daily focus items plus a narrative note
- agents can see/edit only when explicitly enabled in My Agents settings
- Flight Deck talks to Tower PG APIs directly; do not use Yoke

## Ticket FD-DS-1: Remove Scope Dependency From Daily Scope UI

### Goal

Make the Autopilot overview Daily Scope card static across every scope context.

### Current State

The card now renders today's latest local daily note regardless of scope metadata as an immediate bug fix, but create/save/hydration still carries old scope/channel fields until Tower is migrated.

### Required Changes

- Remove Daily Scope selection by `scope_id` / `channel_id`.
- Load Daily Scope by owner/date.
- Keep scope/channel metadata only as optional provenance when Tower supports it.
- Ensure the card renders the same note in:
  - All workspace activity
  - a selected scope
  - a selected channel
  - back/forward navigation

### Acceptance Criteria

- Saving a Daily Scope immediately updates the overview card.
- Switching scope does not change the Daily Scope card.
- The four lower overview panels continue to filter by the selected scope/channel.

## Ticket FD-DS-2: Checklist Plus Narrative Editor

### Goal

Replace the current simple title/focus/note editor with a Daily Scope editor built around today's focus checklist and narrative.

### Required UX

- Card summary:
  - show checklist progress, e.g. `2/5 done`
  - show up to five item labels
  - show a short narrative preview
  - show last updated actor/time when available
- Editor:
  - checklist of max five items
  - add item until five
  - edit item text
  - check/uncheck item
  - remove item
  - narrative textarea
  - preserve optional `focus` for compatibility or derive it from top items
- Empty state:
  - "Create your Daily Scope for today"
  - no mention of "this context"

### Data Shape

Use Tower's `items` array once the API supports it. Suggested local item shape:

```json
{
  "id": "client-or-server-stable-id",
  "text": "Deploy Kindling Pipelines",
  "completed": false,
  "source": "manual|agent",
  "created_at": "ISO timestamp",
  "updated_at": "ISO timestamp"
}
```

### Acceptance Criteria

- User cannot add more than five items.
- Checklist state persists after reload.
- Narrative persists after reload.
- Empty, partially complete, and complete states render cleanly on desktop and mobile.

## Ticket FD-DS-3: My Agents Daily Scope Permission Toggle

### Goal

Expose explicit agent access control where the user configures agents for the Autopilot overview.

### Required UX

- In the settings area where the workspace Autopilot agent/default agent is configured, add a Daily Scope access toggle per selected My Agent.
- Suggested label: `Can read and edit my Daily Scope`.
- The agent should appear on the front page My Agents panel only when it is configured as a user-facing agent.
- Do not give DevOps/background agents Daily Scope access unless explicitly checked.

### Backend Contract

Coordinate with Tower:

- read current Daily Scope agent access list
- grant access for an agent
- revoke access for an agent
- optionally materialize/update the personal `Daily Scope Agents` group if Tower uses the group model

### Acceptance Criteria

- The user can enable Daily Scope access for Wingman 21 without enabling every workspace agent.
- Revoking access updates Tower and the UI state.
- UI copy makes clear this is personal Daily Scope access, not channel access.

## Ticket FD-DS-4: Dexie And Hydration Updates

### Goal

Materialize Daily Scope by note owner/date instead of workspace owner or channel/date.

### Required Changes

- Add/normalize local fields:
  - `owner_actor_id`
  - `owner_actor_npub`
  - `note_date`
  - `items`
  - `updated_by_actor_id`
  - `updated_by_actor_npub` if available
- Replace channel/date helpers with owner/date helpers.
- Update PG event hydrator to refresh by owner/date from Daily Scope outbox events.
- Keep migration compatibility for old rows that only have `owner_npub` as workspace owner and old `pg_scope_id` / `pg_channel_id`.

### Acceptance Criteria

- Live updates refresh the visible Daily Scope even if no channel is selected.
- Old local rows do not crash the UI.
- Local replacement does not delete another person's note for the same date.

## Ticket FD-DS-5: Voice/Agent-Produced Daily Scope Input

### Goal

Prepare the UI contract for the morning voice workflow without blocking the base Daily Scope migration.

### Intended Flow

1. User records or sends a morning note to an agent.
2. Agent summarizes the narrative.
3. Agent extracts three to five top focus items.
4. Agent writes the human's Daily Scope through Tower PG APIs.
5. Flight Deck receives SSE/hydration and updates the card.

### Required Flight Deck Work

- Ensure the card clearly displays agent-produced updates.
- Preserve `source: agent` item metadata where available.
- Show updated-by information if Tower returns actor identity.
- Do not require Flight Deck to run the extraction itself in v1.

### Acceptance Criteria

- Agent-written Daily Scope updates render without manual refresh.
- User can edit agent-produced items and narrative afterward.
- Manual edits preserve checklist item ids where possible.

## Validation

- `bun run test`
- `bun run build`
- Add focused tests for:
  - scope switching does not change Daily Scope
  - max five checklist items
  - save renders immediately
  - SSE owner/date refresh

