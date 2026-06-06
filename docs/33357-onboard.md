# Kind 33357 Flight Deck Onboarding

Status: design draft
Last updated: 2026-06-06

## Purpose

Kind `33357` is the Nostr announcement that lets a Flight Deck user or agent
discover that they have been added to a Wingman/Flight Deck workspace.

It is not the access grant itself. Tower remains the source of truth for
workspace, group, scope, channel, and record access.

The event exists to make onboarding feel immediate:

1. An authorised actor adds a recipient npub to a Flight Deck workspace/group.
2. A kind `33357` event is published to that recipient.
3. Flight Deck or Autopilot decrypts the event.
4. The recipient verifies access with Tower.
5. The client imports the workspace and fetches current groups, scopes, channels,
   docs, `llms.txt`, and other allowed records through authenticated APIs.

## Non-Goals

Do not use kind `33357` to carry live workspace context.

The encrypted payload must not include:

- scope lists;
- channel lists;
- group membership lists;
- task/doc/chat context;
- pipeline routing context;
- inferred graph context.

Those records change over time and must be fetched from Tower after
authentication.

## Event Semantics

Kind `33357` means:

> This npub has an onboarding message for the app identified by `app_pub`.
> Decrypt the event, verify the connection details with Tower, then sync current
> workspace state.

The relay event is only a bootstrap hint. It must be safe for an old relay event
to exist after the recipient's access is revoked, because Tower verification
will reject current access.

## Cleartext Event Shape

Cleartext tags should only support recipient filtering and safe routing. They
must not expose workspace names, scope names, channel names, endpoint URLs, or
connection tokens.

```json
{
  "kind": 33357,
  "pubkey": "<issuer-pubkey-hex>",
  "created_at": 1780710000,
  "tags": [
    ["p", "<recipient-pubkey-hex>"],
    ["app_pub", "<flightdeck-app-pubkey-hex>"],
    ["protocol", "onboarding"]
  ],
  "content": "<encrypted payload for recipient pubkey>"
}
```

Tag meanings:

- `p`: the recipient pubkey that should try to decrypt this event.
- `app_pub`: the app/schema pubkey for the Flight Deck-compatible app.
- `protocol`: the reusable cleartext class of the message. Use `onboarding`.

Do not use a cleartext `app` tag for this contract. Use `app_pub` so the tag is
explicitly a pubkey, not an app label.

If a `d` tag is later required for addressable/replacement behaviour, it must be
opaque and must not encode human-readable workspace, group, scope, or channel
names. The first implementation can avoid depending on replacement semantics by
processing latest valid encrypted payloads by recipient, app, issuer, and
encrypted grant id.

## Encryption

The content must be encrypted to the recipient pubkey from the `p` tag.

The default rule for Nostr relay data in Flight Deck is:

> Anything operational, user-specific, workspace-specific, or connection-bearing
> is encrypted to the expected recipient.

For `33357`, the expected recipient is the person or agent npub that has just
been added to Flight Deck.

## Encrypted Payload

The encrypted content is JSON. It should contain enough to connect and verify,
not enough to replace a Tower sync.

```json
{
  "type": "flightdeck_onboarding",
  "version": 1,
  "protocol": "onboarding",
  "issued_at": "2026-06-06T00:00:00.000Z",
  "expires_at": "2026-06-13T00:00:00.000Z",
  "issued_by_npub": "npub1...",
  "recipient_npub": "npub1...",
  "app": {
    "app_npub": "npub1...",
    "app_pubkey": "<flightdeck-app-pubkey-hex>"
  },
  "service": {
    "direct_https_url": "https://tower.example.com",
    "service_npub": "npub1...",
    "openapi_url": "https://tower.example.com/openapi.json",
    "docs_url": "https://tower.example.com/docs",
    "health_url": "https://tower.example.com/health",
    "relay_urls": ["wss://relay.example.com"]
  },
  "workspace": {
    "owner_npub": "npub1...",
    "workspace_service_npub": "npub1...",
    "label": "Optional human label"
  },
  "agent_connect": {
    "kind": "coworker_agent_connect",
    "version": 5,
    "generated_at": "2026-06-06T00:00:00.000Z",
    "llms_url": "https://flightdeck.example.com/llms.txt",
    "robots_url": "https://flightdeck.example.com/robots.txt",
    "service": {},
    "workspace": {},
    "app": {},
    "connection_token": "<connection token>",
    "notes": []
  },
  "grant": {
    "grant_id": "opaque-id-for-idempotency",
    "reason": "added_to_workspace_or_group"
  }
}
```

Payload requirements:

- `recipient_npub` must match the `p` tag.
- `app.app_pubkey` must match the `app_pub` tag.
- `protocol` must be `onboarding`.
- `agent_connect` should remain compatible with the package produced by
  `src/agent-connect.js`.
- `llms_url` should be present inside `agent_connect`; consumers should read it
  after verifying the workspace.
- `grant.grant_id` is an opaque idempotency key. It is not a permission.

The `agent_connect.connection_token` is sensitive bootstrap material. It is
allowed only because the payload is encrypted to the intended recipient.

## Publisher Flow

### Grant

The user-facing action is:

> Add this npub to this workspace/group.

That action writes the real authorisation state in Tower. The old invite screen
should not be the primary model for permissioning.

### Announce

After Tower confirms the authorised grant, publish a `33357` event encrypted to
the added npub.

The publishing path may live in Flight Deck or Tower, but the semantic order is:

1. Tower authorises and records access.
2. The onboarding payload is built from current service/workspace/app details.
3. The event is encrypted to the recipient.
4. The event is published to configured relays.
5. The UI records whether the announcement was published.

If publishing fails after the access grant succeeds, the grant remains valid.
The UI should report that access exists but the relay announcement did not
publish.

## Human Flight Deck Flow

### Add User To Group

The workspace admin UI should support direct npub entry:

1. Open workspace/group access.
2. Paste or select a recipient npub.
3. Confirm the group/workspace grant.
4. Flight Deck writes the grant through Tower.
5. Flight Deck publishes or requests publication of the `33357` event.

If the person is new, Flight Deck may show a lightweight share modal. This modal
is not the permissioning step. It is only convenience.

Suggested modal actions:

- copy generic workspace open link;
- copy a short message for Signal/WhatsApp/email;
- show that the recipient already has access;
- show relay announcement status.

The link does not need to identify or authorise the person. It can simply open
Flight Deck and let the recipient's login plus `33357` discovery select the
workspace.

### Recipient Login

On login/startup, Flight Deck should:

1. Determine the logged-in user pubkey.
2. Fetch recent `33357` events with:
   - `#p` equal to the user pubkey;
   - `#app_pub` equal to this Flight Deck app pubkey;
   - `#protocol` equal to `onboarding`.
3. Try to decrypt each event.
4. Validate payload fields.
5. Import or stage the Agent Connect package.
6. Call Tower with NIP-98 to verify current access.
7. Fetch the current workspace state through PG APIs or the compatible
   workspace sync path.
8. Show the workspace only after verification succeeds.

### UI States

Flight Deck should distinguish these states:

- `Found`: encrypted onboarding event exists.
- `Verified`: Tower confirms access.
- `Ready`: workspace metadata has synced enough to open.
- `Stale`: event decrypted, but Tower rejected current access.
- `Failed`: decrypt, parse, import, or network verification failed.

Normal workspace lists should show only verified/ready workspaces. Stale or
failed entries can appear in a diagnostics/recovery view, not as selectable
workspaces.

### Open Behaviour

If the user clicks a generic workspace link and a matching verified onboarding
event exists, Flight Deck should open the new workspace directly after sync.

If the user simply logs in later, Flight Deck should surface a small "New
workspace available" row or toast after verification, with an Open action.

## Autopilot And Yoke Flow

Autopilot and Yoke should consume the same `33357` event contract.

For an agent npub:

1. Autopilot watches or polls relays for `33357` events addressed to the agent
   pubkey.
2. It filters by `app_pub` and `protocol=onboarding`.
3. It decrypts the payload with the agent key.
4. It validates the Agent Connect package.
5. It imports or updates the workspace through the existing Agent Connect/Yoke
   path.
6. It verifies current access with Tower.
7. It syncs current groups, scopes, channels, docs, and chat/task records it is
   allowed to see.
8. It reads `llms_url` and stores the workspace guidance as agent context.
9. It can then configure default dispatch routes, chat handling, and
   scope/channel-aware context lookups.

Autopilot must not treat the relay payload as the list of current groups or
channels. It must fetch those from Tower after import.

## Scope, Channel, And Context Hydration

The slick onboarding outcome depends on the post-verification sync, not on
putting context into the event.

After verification, clients should fetch:

- workspace identity and labels;
- groups the actor belongs to;
- scopes visible to that actor;
- channels visible to that actor;
- scope/channel descriptions;
- linked docs and `llms.txt`;
- current chat/task/doc records according to access.

Those records give agents enough context to answer naturally when a user starts
chatting in a scope or channel. For example, an Autopilot-scoped channel can
later bind to Autopilot-specific policies, local repo context, and custom chat
pipelines.

## Security Rules

- Tower grants access. Nostr announces that the recipient should verify.
- Relay events are never the source of truth for current access.
- Operational URLs, connection tokens, workspace ids, labels, and relay hints
  belong in encrypted content.
- Scope/channel/group lists are not part of the `33357` payload.
- Revocation is enforced by Tower verification, not relay deletion.
- Expired payloads should not be imported automatically.
- Duplicate payloads should be idempotent by encrypted `grant.grant_id`,
  service identity, workspace owner, app pubkey, and recipient.

## Deferred Kind 33355 Endpoint Announcement

Kind `33355` is a related but deferred idea. It would announce that an npub has
a Wingman-style endpoint that Flight Deck can contact directly, for example to
ping an Autopilot endpoint and trigger message checks without relying only on
SSE subscriptions.

This is useful later, but `33357` should be built first.

For `33355`, the cleartext event should be even smaller:

```json
{
  "kind": 33355,
  "pubkey": "<announcing-pubkey-hex>",
  "tags": [
    ["p", "<flightdeck-app-pubkey-hex>"]
  ],
  "content": "<encrypted endpoint payload for Flight Deck app pubkey>"
}
```

Do not use cleartext `d` or `protocol` tags for `33355` in the current design.
The endpoint URL, capabilities, health URL, `llms.txt`, and protocol details
belong in the encrypted payload.

The endpoint URL should be configured in Autopilot admin options before
Autopilot publishes `33355`. Any direct endpoint call must still be
authenticated, normally with NIP-98.

