# Kind 33356/33357 Flight Deck Workspace Discovery

Status: design draft
Last updated: 2026-06-07

## Purpose

Flight Deck PG workspaces should feel portable across devices.

After a user has logged into a workspace once, they should not need to repeatedly
paste Tower URLs, generate connection tokens, or manually re-enter workspace
locators on every browser, phone, or app install. Their Nostr identity already
gives us a user-owned discovery mailbox: encrypted Nostr events addressed to
their npub.

This design uses two related event kinds:

- Kind `33356`: a self-published, encrypted workspace self-index. One event per
  verified workspace.
- Kind `33357`: an encrypted onboarding/grant notice sent to a user or agent
  when someone else adds them to a workspace.

Tower remains the source of truth. These events are discovery hints, not access
grants.

## Product Outcomes

- A user enters a Tower URL or descriptor once.
- After verification, Flight Deck publishes a self-index event for that
  workspace.
- On a new device, the user logs in with the same Nostr identity and verified
  workspaces appear automatically.
- If a workspace admin adds a user or agent to a workspace, that recipient can
  discover the workspace from `33357` after login.
- If Tower later revokes access, stale relay events do not preserve access.

## Authority Model

The event flow must preserve one simple rule:

> Nostr discovers possible workspaces. Tower decides current access.

Clients must verify each decrypted locator with Tower before showing it as an
available workspace.

If an event says a user knows about workspace `X` but Tower `/me` rejects the
actor, the app should hide or mark that locator stale.

## Event Roles

### Kind 33356: Self-Index Locator

Kind `33356` is published by the logged-in user to themselves after they have
verified a workspace.

Use it for:

- cross-device workspace discovery;
- restoring `knownWorkspaces` after a fresh browser login;
- avoiding repeated Tower URL or descriptor entry;
- remembering PG workspace locators that carry no bearer auth.

Do not use it for:

- granting access to someone else;
- carrying live workspace records;
- storing group/channel/task/doc lists;
- replacing Tower workspace membership checks.

### Kind 33357: Onboarding Notice

Kind `33357` is published to a recipient when an authorised actor adds that
recipient to a workspace or group.

Use it for:

- "Pete added wm21 to this Tower workspace";
- "Andy was added to this company workspace";
- "An Autopilot agent npub has a new workspace to import";
- prompting the recipient to verify and import the workspace.

Do not use it for:

- current record state;
- current group/channel/scope lists;
- permanent membership authority;
- replacing the recipient's own `33356` self-index.

Once a recipient verifies a `33357` notice with Tower, the recipient's client
should publish its own `33356` self-index event for that workspace.

## Kind 33356 Shape

Kind `33356` is a parameterized replaceable event. Publish one event per
workspace.

Cleartext tags should support filtering without leaking human workspace names,
scope names, channel names, Tower URLs, or credentials.

```json
{
  "kind": 33356,
  "pubkey": "<user-pubkey-hex>",
  "created_at": 1780710000,
  "tags": [
    ["d", "fd-self:<opaque-workspace-hash>"],
    ["p", "<user-pubkey-hex>"],
    ["app_pub", "<flightdeck-app-pubkey-hex>"],
    ["protocol", "workspace-self-index"],
    ["v", "1"]
  ],
  "content": "<encrypted payload for user pubkey>"
}
```

`d` tag:

- deterministic for the same user/app/Tower/workspace identity;
- opaque, for example `fd-self:` plus a hash;
- must not include plain Tower URLs, workspace labels, scope names, or channel
  names.

Suggested hash input:

```text
v1:<user_pubkey_hex>:<app_pubkey_hex>:<tower_service_pubkey_hex>:<workspace_id>
```

Clients do not need to know `d` in advance. On login they query by author,
kind, `#p`, `#app_pub`, and `#protocol`.

### Kind 33356 Encrypted Payload

The payload is encrypted to the user's own pubkey.

Prefer NIP-44 encryption when the signer supports it. Fall back to NIP-04 only
if required by the available signer/runtime. If the runtime cannot encrypt to
self, the client should keep the locator locally and show a recoverable
"workspace discovery not backed up to relays" state.

```json
{
  "type": "flightdeck_workspace_self_index",
  "version": 1,
  "issued_at": "2026-06-07T00:00:00.000Z",
  "updated_at": "2026-06-07T00:00:00.000Z",
  "user_npub": "npub1...",
  "app": {
    "app_npub": "npub1...",
    "app_pubkey": "<flightdeck-app-pubkey-hex>",
    "namespace": "flightdeck_pg"
  },
  "workspace": {
    "type": "wingman_workspace_locator",
    "version": 1,
    "tower_base_url": "https://sb4.otherstuff.studio",
    "tower_service_npub": "npub1...",
    "workspace_id": "uuid",
    "workspace_service_npub": "npub1...",
    "workspace_owner_npub": "npub1...",
    "app_npub": "npub1...",
    "label": "Wingers",
    "description": "Optional user-facing label",
    "capabilities": [
      "pg_scopes",
      "pg_channels",
      "pg_channel_grants",
      "pg_tasks",
      "pg_chat",
      "realtime_events"
    ],
    "links": {
      "descriptor": "/api/v4/flightdeck-pg/workspaces/uuid/descriptor",
      "me": "/api/v4/flightdeck-pg/workspaces/uuid/me",
      "scopes": "/api/v4/flightdeck-pg/workspaces/uuid/scopes",
      "events": "/api/v4/flightdeck-pg/workspaces/uuid/events"
    }
  },
  "verification": {
    "last_verified_at": "2026-06-07T00:00:00.000Z",
    "verified_by": "flightdeck",
    "tower_service_npub": "npub1..."
  },
  "state": {
    "deleted": false
  }
}
```

For PG workspaces this payload must not carry a bearer token or database
credential. It is effectively the same credential-free locator that the user
could paste manually.

Legacy encrypted-record or Agent Connect flows may still have encrypted
connection-token payloads, but those are outside the PG self-index contract and
should not be reintroduced for PG workspace access.

## Kind 33357 Shape

Kind `33357` is a parameterized replaceable onboarding notice addressed to a
recipient.

```json
{
  "kind": 33357,
  "pubkey": "<issuer-pubkey-hex>",
  "created_at": 1780710000,
  "tags": [
    ["d", "fd-onboard:<opaque-grant-hash>"],
    ["p", "<recipient-pubkey-hex>"],
    ["app_pub", "<flightdeck-app-pubkey-hex>"],
    ["protocol", "workspace-onboarding"],
    ["v", "1"]
  ],
  "content": "<encrypted payload for recipient pubkey>"
}
```

`pubkey` is the actor that publishes the notice. In practice this may be:

- the workspace admin's browser;
- Tower's service identity;
- an Autopilot or Yoke process acting from an authorised admin flow.

The publishing identity is not the grant. Tower membership is the grant.

### Kind 33357 Encrypted Payload

The payload is encrypted to the recipient from the `p` tag.

```json
{
  "type": "flightdeck_workspace_onboarding",
  "version": 1,
  "issued_at": "2026-06-07T00:00:00.000Z",
  "expires_at": "2026-06-14T00:00:00.000Z",
  "issued_by_npub": "npub1...",
  "recipient_npub": "npub1...",
  "app": {
    "app_npub": "npub1...",
    "app_pubkey": "<flightdeck-app-pubkey-hex>",
    "namespace": "flightdeck_pg"
  },
  "workspace": {
    "type": "wingman_workspace_locator",
    "version": 1,
    "tower_base_url": "https://sb4.otherstuff.studio",
    "tower_service_npub": "npub1...",
    "workspace_id": "uuid",
    "workspace_service_npub": "npub1...",
    "workspace_owner_npub": "npub1...",
    "app_npub": "npub1...",
    "label": "Wingers",
    "links": {
      "descriptor": "/api/v4/flightdeck-pg/workspaces/uuid/descriptor",
      "me": "/api/v4/flightdeck-pg/workspaces/uuid/me"
    }
  },
  "grant": {
    "grant_id": "opaque-id-for-idempotency",
    "reason": "added_to_workspace_or_group"
  }
}
```

Payload requirements:

- `recipient_npub` must match the cleartext `p` tag.
- `app.app_pubkey` must match the cleartext `app_pub` tag.
- `workspace.type` must be `wingman_workspace_locator`.
- `grant.grant_id` is an idempotency key only, not a permission.
- `expires_at` controls automatic import attempts. Expired notices can remain in
  diagnostics but should not auto-import.

## Login Discovery Flow

On every login or app startup with a Nostr signer:

1. Resolve the logged-in pubkey.
2. Query configured relays for kind `33356` events:
   - author equals the logged-in pubkey;
   - `#p` equals the logged-in pubkey;
   - `#app_pub` equals the current app pubkey;
   - `#protocol` equals `workspace-self-index`.
3. Decrypt and validate each self-index payload.
4. Query configured relays for kind `33357` events:
   - `#p` equals the logged-in pubkey;
   - `#app_pub` equals the current app pubkey;
   - `#protocol` equals `workspace-onboarding`.
5. Decrypt and validate each onboarding payload.
6. Deduplicate locators by app, Tower service npub, workspace id, and workspace
   service npub.
7. For each candidate locator, call Tower:
   - `GET /api/v4/flightdeck-pg/workspaces/:workspaceId/descriptor`
   - `GET /api/v4/flightdeck-pg/workspaces/:workspaceId/me`
8. Merge verified workspaces into `knownWorkspaces`.
9. Hide or mark stale any locator that Tower rejects.
10. For verified `33357` onboarding notices, publish or refresh the recipient's
    own `33356` self-index event for that workspace.

The app should show a small "Workspace discovered" state when new verified
workspaces appear.

## First Connection Flow

When a user manually enters a Tower URL, scans a descriptor, or creates a new PG
workspace:

1. Flight Deck validates the descriptor shape locally.
2. Flight Deck verifies Tower service metadata.
3. Flight Deck signs NIP-98 requests and calls Tower `/descriptor` and `/me`.
4. If Tower confirms access, Flight Deck stores the locator in local
   `knownWorkspaces`.
5. Flight Deck publishes a kind `33356` self-index event for that workspace.
6. The workspace becomes available on future devices after Nostr login.

If self-index publishing fails, the workspace should still open locally. The UI
should show that cross-device discovery is not yet backed up.

## Admin Add-User Flow

When an admin adds a user/agent npub to a workspace or group:

1. Admin action writes the real access grant in Tower.
2. Tower or the admin client builds a credential-free PG workspace locator.
3. Tower/client publishes a kind `33357` onboarding notice encrypted to the
   recipient.
4. The admin UI reports:
   - access grant succeeded;
   - onboarding notice published, failed, or pending.

If publishing fails, the Tower access grant remains valid. The recipient can
still join through a manual descriptor/link, and the notice can be retried.

## Autopilot And Yoke Flow

Autopilot/Yoke should consume the same event contract.

For an agent npub:

1. Poll or subscribe to relays for `33357` notices addressed to the agent.
2. Decrypt with the agent key.
3. Verify the locator with Tower using NIP-98.
4. Import the workspace into Yoke's workspace config.
5. Fetch current scopes, channels, docs, `llms.txt`, and visible records from
   Tower.
6. Publish or store an agent-owned `33356` self-index where appropriate.

Autopilot work to retrieve `33357` notices can land separately. Flight Deck
should not block its self-index flow on Autopilot support.

## UI States

Flight Deck should distinguish:

- `Local only`: workspace exists in local Dexie settings but has no relay
  self-index backup.
- `Indexed`: kind `33356` was published for the workspace.
- `Discovered`: relay event decrypted and parsed.
- `Verified`: Tower confirms current access.
- `Ready`: enough workspace metadata has synced to open.
- `Stale`: event decrypts, but Tower rejects current access.
- `Failed`: decrypt, parse, network, or verification failed.

Normal workspace lists should show `Verified` and `Ready` workspaces. Stale or
failed entries belong in diagnostics/recovery.

## Deletion And Revocation

Revocation:

- Admin removes access in Tower.
- Old `33356` or `33357` events may remain on relays.
- Future Tower `/me` verification rejects access.
- Client marks the locator stale and hides it from normal workspace switching.

User removes from their local list:

- Client removes the workspace from local `knownWorkspaces`.
- Client should publish a replacement `33356` event using the same `d` tag with
  `state.deleted=true`.
- Other devices that decrypt the tombstone should remove or hide that self-index
  entry.

This does not revoke Tower access. It only removes the user's personal discovery
entry.

## Relay Strategy

First implementation can use:

- app default relays;
- relays configured in the user's Flight Deck settings;
- relays exposed by the Nostr signer when available;
- later, the user's NIP-65 relay list.

Publishing should be best effort across multiple relays. A locator is considered
published if at least one configured relay accepts it, but the UI should record
partial failures for diagnostics.

## Security Rules

- Tower grants access.
- Nostr events announce or remember where to verify access.
- Cleartext tags must not expose workspace names, scope names, channel names,
  URLs, or tokens.
- PG self-index payloads must not contain bearer tokens or database credentials.
- Scope/channel/group/task/doc lists are not part of either payload.
- Revocation is enforced by Tower verification.
- Duplicate payloads are idempotent by app pubkey, Tower service pubkey,
  workspace id, workspace service npub, and recipient.
- Expired `33357` payloads should not auto-import.
- `33356` self-index entries should be refreshable after successful Tower
  verification.

## Open Decisions

- Exact app pubkey/namespace for `wm-fd-2` PG mode in cleartext `app_pub`.
- Whether Flight Deck browser code or Tower service should publish `33357` for
  admin add-user flows.
- Whether Tower should expose a "publish onboarding notice" helper endpoint that
  returns a signed event, publishes directly, or both.
- Which encryption API is mandatory for launch: NIP-44 only, or NIP-44 with
  NIP-04 fallback.
- Whether deletion tombstones should be automatic when Tower reports revoked
  access, or only when the user explicitly removes the workspace from their
  personal list.

## Implementation Slices

### Slice 1: Flight Deck Self-Index

- Add relay query/publish helpers for `33356`.
- After successful PG workspace verification, publish one self-index event.
- On login, query/decrypt `33356`, verify with Tower, and merge into
  `knownWorkspaces`.
- Show local/indexed/discovered/verified states.

### Slice 2: Flight Deck Onboarding Notices

- Add relay query/decrypt helpers for `33357`.
- On login, process onboarding notices after self-index locators.
- Verify with Tower.
- Merge verified workspaces.
- Publish recipient-owned `33356` after successful `33357` import.

### Slice 3: Admin/Tower Publish Flow

- When a workspace admin adds a user or agent, publish or request publication of
  a `33357` notice.
- Record publish status in the admin UI.
- Add retry diagnostics for relay failures.

### Slice 4: Autopilot/Yoke Consumption

- Poll/query relays for `33357` addressed to the agent npub.
- Import verified workspaces into Yoke.
- Fetch workspace guidance and current visible state from Tower.
