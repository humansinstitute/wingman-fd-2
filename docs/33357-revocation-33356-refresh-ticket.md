# Kind 33357 Revocation And Kind 33356 Refresh Ticket

Status: implementation ticket
Last updated: 2026-06-08

## Goal

Flight Deck and Autopilot must respond correctly when a recipient receives a
signed kind `33357` event that says a Flight Deck workspace onboarding grant has
been revoked or the workspace has been deleted.

The important rule is:

> A relay event is advisory. Before removing a workspace connection or
> republishing kind `33356`, the client must verify the current workspace state
> with Tower.

This avoids old, spoofed, replayed, or partially propagated relay events
disconnecting a valid workspace.

## Related Contracts

- `docs/33357-onboard.md`
- `docs/33356-workspace-self-index.md`
- `/Users/mini/code/wingmanbefree/autopilot/docs/33357-onboard-consumer.md`

No new Nostr kind is required for this slice unless implementation proves that a
separate contract is cleaner. Start with an extended kind `33357` lifecycle
payload and a kind `33356` tombstone refresh.

## Revocation Payload Semantics

Kind `33357` remains encrypted to the recipient in the `p` tag and cleartext
tags stay minimal:

```json
{
  "kind": 33357,
  "tags": [
    ["p", "<recipient-pubkey-hex>"],
    ["app_pub", "<flightdeck-app-pubkey-hex>"],
    ["protocol", "onboarding"]
  ],
  "content": "<encrypted payload for recipient pubkey>"
}
```

The encrypted payload should support both active onboarding and revocation
lifecycle messages:

```json
{
  "type": "flightdeck_onboarding",
  "version": 1,
  "protocol": "onboarding",
  "action": "revoked",
  "issued_at": "2026-06-08T00:00:00.000Z",
  "issued_by_npub": "npub1...",
  "recipient_npub": "npub1...",
  "app": {
    "app_npub": "npub1...",
    "app_pubkey": "<flightdeck-app-pubkey-hex>"
  },
  "service": {
    "direct_https_url": "https://tower.example.com",
    "service_npub": "npub1..."
  },
  "workspace": {
    "workspace_id": "uuid",
    "workspace_service_npub": "npub1...",
    "owner_npub": "npub1..."
  },
  "revocation": {
    "reason": "workspace_deleted",
    "revoked_at": "2026-06-08T00:00:00.000Z",
    "source": "tower"
  },
  "grant": {
    "grant_id": "opaque-id-for-idempotency",
    "reason": "workspace_deleted"
  }
}
```

`action` values:

- `grant`: active onboarding. Missing `action` should be treated as `grant` for
  compatibility with existing events.
- `revoked`: recipient access was removed or the workspace was deleted.
- `deleted`: alias for a workspace deletion. Consumers may normalize this to
  `revoked` with reason `workspace_deleted`.

Do not include scope, channel, group, task, doc, dispatch, or context hints in
revocation payloads. Consumers must fetch current state from Tower.

## Verification Before Acting

When a revocation/deletion event is decrypted, the consumer must:

1. Validate event tags and encrypted payload shape.
2. Resolve the workspace identity from app pubkey, Tower service npub/base URL,
   workspace id, and workspace service npub.
3. Call Tower with the recipient's current NIP-98 identity.
4. Treat the revocation as confirmed only when Tower reports one of:
   - workspace descriptor not found;
   - workspace deleted/tombstoned;
   - recipient is not a workspace member;
   - recipient cannot access `/me` for that workspace.
5. If Tower still returns a valid descriptor and `/me` membership, keep the
   workspace active and record a diagnostic explaining that the relay revocation
   did not match Tower state.

The client must not disconnect a workspace, stop a subscription, or publish a
kind `33356` tombstone based only on a decrypted `33357`.

## Kind 33356 Refresh Semantics

After Tower confirms the workspace is revoked/deleted for this recipient, the
recipient should refresh their kind `33356` self-index for that workspace.

Prefer a replacement event with the same deterministic `d` tag and a tombstone
state rather than only omitting the workspace locally. Omission makes it hard for
another device to distinguish "not seen yet" from "intentionally removed".

Suggested encrypted state:

```json
{
  "type": "flightdeck_workspace_self_index",
  "version": 1,
  "updated_at": "2026-06-08T00:00:00.000Z",
  "user_npub": "npub1...",
  "app": {
    "app_npub": "npub1...",
    "app_pubkey": "<flightdeck-app-pubkey-hex>",
    "namespace": "flightdeck_pg"
  },
  "workspace": {
    "tower_base_url": "https://tower.example.com",
    "tower_service_npub": "npub1...",
    "workspace_id": "uuid",
    "workspace_service_npub": "npub1...",
    "workspace_owner_npub": "npub1...",
    "app_npub": "npub1..."
  },
  "verification": {
    "last_checked_at": "2026-06-08T00:00:00.000Z",
    "verified_by": "flightdeck",
    "tower_result": "workspace_deleted"
  },
  "state": {
    "deleted": true,
    "status": "deleted",
    "deleted_at": "2026-06-08T00:00:00.000Z",
    "reason": "workspace_deleted",
    "source_33357_event_id": "<event-id>"
  }
}
```

Consumers of kind `33356` should hide tombstoned entries from normal workspace
lists and should not auto-reconnect them. Diagnostics can still show the
tombstone and the Tower verification result.

## Flight Deck Implementation Requirements

Flight Deck should:

- parse active and revoked/deleted `33357` payloads;
- group onboarding events by workspace identity, not only by event id;
- keep existing active onboarding import behavior for active grants;
- for revoked/deleted events, verify with Tower before changing local state;
- remove or hide the local PG workspace only after Tower confirms deletion or
  lost membership;
- prevent auto-selection or auto-reconnection of confirmed deleted/revoked
  workspaces;
- publish a replacement kind `33356` tombstone after confirmed revocation;
- leave a diagnostic state when Tower still says the workspace is valid;
- add focused tests for confirmed revocation, unconfirmed revocation, and
  tombstone publication.

Suggested files to inspect first:

- `src/nostr-onboarding-announcements.js`
- `src/onboarding-announcements-manager.js`
- `src/nostr-workspace-self-index.js`
- `src/workspace-self-index-manager.js`
- `tests/nostr-onboarding-announcements.test.js`
- `tests/onboarding-announcements-manager.test.js`
- `tests/nostr-workspace-self-index.test.js`
- `tests/workspace-self-index-manager.test.js`

## Autopilot Implementation Requirements

Autopilot should:

- update the kind `33357` consumer to accept `action: grant|revoked|deleted`;
- continue treating missing `action` as an active grant;
- verify revoked/deleted events against Tower before changing connection state;
- mark the Flight Deck connection/profile as revoked/deleted only after Tower
  confirms deletion or lost membership;
- stop or ignore SSE/event handling for the confirmed revoked workspace;
- keep the workspace active and record diagnostics if Tower still confirms
  access;
- republish or refresh Autopilot's 33356/self-index equivalent after confirmed
  removal so other devices/runtimes do not auto-connect stale workspaces;
- update the Flight Deck settings tab so only explicit, verified active
  workspace connections appear in the normal list, with revoked/deleted entries
  available only as diagnostics or history;
- add focused tests for confirmed revocation, unconfirmed revocation, and
  self-index refresh/tombstone behavior.

Suggested files to inspect first:

- `src/access-grants/sbip0009.ts`
- `src/nostr/access-grant-listener.ts`
- `src/flightdeck/onboarding-connections.ts`
- `src/ui/views/settings/flight-deck-section.js`
- `src/ui/views/settings/flight-deck-section.test.js`
- `src/config.ts`
- `docs/33357-onboard-consumer.md`

## Acceptance Criteria

- A signed revoked/deleted `33357` alone does not disconnect a workspace.
- A revoked/deleted `33357` followed by Tower confirmation removes or hides the
  workspace connection.
- A revoked/deleted `33357` followed by Tower confirmation republishes a
  `33356` tombstone/revocation refresh.
- A revoked/deleted `33357` followed by Tower still confirming access leaves the
  workspace active and records a clear diagnostic.
- Existing active onboarding still imports and verifies as before.
- Existing stale active onboarding remains diagnostic-only when Tower rejects
  access.
- Tests cover the new behavior in both Flight Deck and Autopilot.

## Worker Constraints

- Work on `main` unless Pete explicitly redirects.
- Preserve concurrent changes and unrelated dirty files.
- Commit all nonignored tested state in the repo you modify.
- Do not restart local Autopilot, Tower, Flight Deck, or dev server processes.
- If a restart is needed for live verification, report that requirement instead
  of restarting.
