# PG Edit Leases And Offline Editing

## Purpose

Tower PG mode has a canonical database source of truth. It should not reuse the encrypted-record checkout model for synced PG records.

This document defines the first PG-native editing rule for tasks and documents:

- Synced PG records are viewable while offline.
- Synced PG records are not editable while offline.
- New local records created while offline can be edited locally until they are first synced to Tower PG.
- Online edits to synced PG records require a short-lived Tower edit lease before the UI enters edit mode.

This supersedes `docs/checkout_semantics.md` for `tower-pg` backend mode. The old checkout semantics still apply to encrypted-record mode.

## Product Rule

In PG mode, Dexie is a local materialized cache and Tower PG is master.

Offline behavior:

- The user can browse cached scopes, channels, threads, tasks, docs, files, comments, and reactions.
- The user can create a new local task or document if the UI has enough cached channel/scope context to queue it.
- The user can keep editing that unsynced local task or document until Tower accepts it.
- The user cannot edit an existing synced task or document while offline.
- Do not create offline drafts for synced records in this slice.

Online behavior:

- Existing synced task and document edit mode must acquire a Tower PG edit lease first.
- Saves must include the lease token and expected row version.
- If the lease cannot be acquired, the UI stays in view mode and explains who/what holds the edit lease when Tower can report it.
- If the row version is stale, the UI reloads Tower source of truth and shows a conflict/stale-state message.
- Lease release is best effort on save, cancel, close, or route change.

## Record State Vocabulary

The app should make these states explicit in PG mode. The exact property names can follow the existing codebase, but the semantics must be testable.

- `pg_synced`: the row came from Tower PG or has been accepted by Tower PG and has an authoritative PG id plus row version.
- `pg_pending_create`: the row was created locally and has not yet been accepted by Tower PG.
- `pg_pending_update`: reserved for future online/offline update queue work. Do not use this to permit offline edits of synced rows in this slice.
- `pg_sync_failed`: a local create failed to sync but can still be edited locally and retried because Tower has not accepted it as canonical.
- `pg_lease_held`: the current actor holds a non-expired edit lease for this synced row.
- `pg_lease_blocked`: another actor holds the lease or the actor lacks write permission.

Implementation may encode this through existing `sync_status`, PG metadata, and helper predicates. The important rule is:

`canEditOffline(record) === true` only when the record is PG mode and has not been accepted by Tower PG yet.

## Lease Scope

First implementation scope:

- Task detail edit sessions.
- Document edit sessions.

Out of scope for this slice:

- Field-level task leases.
- Block-level collaborative document leases.
- Live cursor/presence.
- Offline drafts for synced rows.
- Comments/reactions. These are append-only enough for the current adapter path and should not block behind task/doc edit leases unless the product decision changes.

Lease target keys:

- `workspace_id`
- `entity_type`: `task` or `document`
- `entity_id`: Tower PG row id
- optional `field_path`: null for whole-record lease in this slice
- optional `subresource_type` / `subresource_id`: null for whole-record lease in this slice

Default TTL:

- 120 seconds.
- Renew while the edit session is open and the user is active.
- Stop renewing and release when the edit session ends.
- Tower must treat expired leases as reclaimable.

## Tower Contract

Add PG-native lease routes under the existing PG API namespace:

- `POST /api/v4/flightdeck-pg/workspaces/:workspaceId/edit-leases/acquire`
- `POST /api/v4/flightdeck-pg/workspaces/:workspaceId/edit-leases/:leaseId/renew`
- `POST /api/v4/flightdeck-pg/workspaces/:workspaceId/edit-leases/:leaseId/release`
- Optional read helper: `GET /api/v4/flightdeck-pg/workspaces/:workspaceId/edit-leases?entity_type=task&entity_id=...`

Acquire request:

```json
{
  "entity_type": "task",
  "entity_id": "uuid",
  "field_path": null,
  "ttl_seconds": 120
}
```

Acquire response:

```json
{
  "lease": {
    "id": "uuid",
    "entity_type": "task",
    "entity_id": "uuid",
    "lease_token": "opaque-token",
    "holder_actor_npub": "npub...",
    "expires_at": "2026-06-06T00:00:00.000Z"
  }
}
```

Blocked response:

```json
{
  "error": "edit lease is held",
  "code": "edit_lease_held",
  "status": 409,
  "holder_actor_npub": "npub...",
  "expires_at": "2026-06-06T00:00:00.000Z"
}
```

Authorization:

- Tower resolves the NIP-98 signer to an actor.
- Tower checks that the actor has write access to the target task/document through the existing PG workspace/group/channel ACL service.
- Tower rejects actors without write access before issuing a lease.
- Tower rejects save mutations for synced tasks/docs unless the actor supplies a valid, unexpired lease token for that target row.

Persistence:

- Add a `flightdeck_pg_edit_leases` table or equivalent service-owned table.
- Store holder actor, target, lease token hash or opaque token, expiry, release timestamp, and timestamps.
- Expired matching leases should be released or overwritten transactionally before issuing a new lease.

## Flight Deck Contract

PG mode must not call encrypted-record checkout helpers for task/doc edit sessions.

Add PG edit helpers that:

- Detect whether the current workspace is `tower-pg`.
- Detect whether the app is online and Tower PG is reachable.
- Detect whether the row is synced or unsynced local.
- Acquire, renew, and release Tower edit leases for synced rows.
- Include `lease_token` and `row_version` in synced task/doc save calls.

Task detail:

- Existing synced task opens read-only.
- Edit button calls `beginPgEditSession("task", taskPgId)`.
- If offline, show read-only state: `Reconnect to edit synced PG tasks.`
- If lease acquire succeeds, enter existing edit UI.
- Save sends the update to Tower with `lease_token` and expected row version.
- Cancel or close releases the lease.
- Locally created unsynced task remains editable offline until first sync succeeds.

Document editor:

- Existing synced document opens preview/read mode.
- Edit button calls `beginPgEditSession("document", docPgId)`.
- If offline, show read-only state: `Reconnect to edit synced PG documents.`
- If lease acquire succeeds, enter existing editor.
- Save sends the update to Tower with `lease_token` and expected row version.
- Cancel, close, or switching document releases the lease.
- Locally created unsynced document remains editable offline until first sync succeeds.

## Acceptance Tests

Worker must add focused tests that prove:

- PG mode synced task cannot enter edit mode while offline.
- PG mode synced document cannot enter edit mode while offline.
- PG mode unsynced local task can be created and edited while offline.
- PG mode unsynced local document can be created and edited while offline.
- Online synced task edit acquire calls the Tower edit lease API before edit mode.
- Online synced document edit acquire calls the Tower edit lease API before edit mode.
- Save for synced task/document includes lease token and expected row version.
- Lease acquire conflict keeps the UI in view mode and surfaces a deterministic message.
- Encrypted-record backend mode still uses existing checkout behavior and is not regressed.

Tower tests should cover:

- Acquire, renew, release.
- Expired lease reclaim.
- No-write-access acquire rejection.
- Save without valid lease rejected for synced task/document updates.
- Save with valid lease accepted.

## Human Test

After implementation and app restart:

1. Log into a PG workspace.
2. Open an existing synced task while online and enter edit mode.
3. Confirm edit mode works and save persists after refresh.
4. Turn Tower/app connectivity offline and refresh.
5. Confirm existing synced tasks/docs are viewable but cannot enter edit mode.
6. Create a new task or document offline.
7. Confirm that new unsynced local record can still be edited offline.
8. Reconnect and confirm the local record syncs, then becomes subject to normal online lease rules.
