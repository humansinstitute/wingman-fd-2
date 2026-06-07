# PH5-04 Nostr 33357 Onboarding Announcements

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/33357-onboard.md`
- `docs/33356-workspace-self-index.md`
- `docs/pg-migration/work-packages/PH5-03-nostr-33356-workspace-self-index.md`
- `/Users/mini/code/wingmanbefree/autopilot/docs/33357-onboard-consumer.md`
- `/Users/mini/code/wingmanbefree/autopilot/src/access-grants/sbip0009.ts`
- `/Users/mini/code/wingmanbefree/autopilot/src/nostr/access-grant-listener.ts`

## Current State

Flight Deck has the kind `33357` contract documented, and Autopilot consumes the
simple onboarding shape:

- `kind: 33357`
- `#p: <recipient pubkey hex>`
- `#app_pub: <Flight Deck app pubkey hex>`
- `#protocol: onboarding`
- encrypted payload `type: "flightdeck_onboarding"`
- encrypted payload includes `agent_connect`

Flight Deck does not yet publish this event when a person or agent is added to a
workspace/group. The old kind `9256` workflow-trigger path has been removed and
must not be revived.

## Scope

Implement Flight Deck publishing and discovery for kind `33357` onboarding
announcements.

This is the "someone added me to a workspace, so my Flight Deck or Autopilot can
find and verify it" slice:

- After Tower confirms that a recipient npub was granted workspace/group access,
  Flight Deck publishes a kind `33357` onboarding announcement encrypted to that
  recipient.
- On recipient login/startup, Flight Deck queries configured relays for matching
  `33357` events, decrypts valid payloads, verifies access with Tower, and
  imports or stages the workspace via the existing Agent Connect path.
- The event is only a bootstrap hint. Tower remains the authority for current
  access, scopes, channels, groups, and records.

## Related 33356 Work

Another agent is working on kind `33356`, which is workspace self-registration
for cross-device compatibility.

Keep the responsibilities separate:

- `33356` is self-indexed by the logged-in user for "my existing workspaces
  should follow me across devices."
- `33357` is sent to a recipient by an authorised actor for "you were just added
  to this workspace/group."
- `33356` should not carry Agent Connect connection tokens.
- `33357` may carry the Agent Connect package only inside encrypted content for
  the expected recipient.

Do not change the `33356` event format, protocol string, payload shape, or
publish/discovery implementation in this ticket unless a tiny shared helper is
needed and is coordinated with the `33356` worker.

## Explicit Non-Scope

- Do not reintroduce the old kind `9256` Nostr workflow trigger system.
- Do not add cleartext workspace names, Tower URLs, connection tokens, scope
  names, channel names, group lists, task/doc/chat context, or pipeline routing
  context to the `33357` event tags.
- Do not use cleartext `app` tags. Use `app_pub`.
- Do not use `33357` to represent current access. Always verify with Tower.
- Do not include live scope/channel/group/context hints in the encrypted
  payload. Fetch those from Tower after verification.
- Do not block the actual Tower grant if relay publication fails.
- Do not require replacement semantics or a cleartext `d` tag for the first
  implementation.

## Required Behaviour

### Publish After Access Grant

When a workspace admin adds a recipient npub to a workspace/group and Tower
confirms the write:

1. Build the current Agent Connect package using `src/agent-connect.js`.
2. Build a `flightdeck_onboarding` payload from the verified workspace/service
   descriptor and the Agent Connect package.
3. Encrypt the payload to the recipient pubkey from the `p` tag.
4. Sign a kind `33357` event as the current Flight Deck user/signer.
5. Publish it to configured relays.
6. Record publish status in the UI:
   - access granted, announcement published;
   - access granted, announcement failed;
   - local/diagnostic state if encryption or signing is unavailable.

Publishing failure must not roll back the Tower access grant.

### Cleartext Event Shape

The cleartext event must match:

```json
{
  "kind": 33357,
  "tags": [
    ["p", "<recipient-pubkey-hex>"],
    ["app_pub", "<flightdeck-app-pubkey-hex>"],
    ["protocol", "onboarding"]
  ],
  "content": "<encrypted JSON payload>"
}
```

No cleartext `d`, `app`, `app_npub`, `service_npub`, `workspace_owner_npub`,
`workspace_service_npub`, `recipient`, `issuer`, or `grant` tags are required or
expected for this contract.

### Encrypted Payload Shape

The encrypted JSON payload must include:

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
    "relay_urls": ["wss://relay.example"]
  },
  "workspace": {
    "owner_npub": "npub1...",
    "workspace_service_npub": "npub1...",
    "label": "Optional human label"
  },
  "agent_connect": {
    "kind": "coworker_agent_connect",
    "version": 5,
    "connection_token": "<encrypted-payload-only token>"
  },
  "grant": {
    "grant_id": "opaque-id-for-idempotency",
    "reason": "added_to_workspace_or_group"
  }
}
```

The implementation may include additional Agent Connect fields already emitted
by `buildAgentConnectPackage`, but must not add live scope/channel/group
snapshots.

### Recipient Discovery

On login/startup with a Nostr signer:

1. Resolve the logged-in user's pubkey.
2. Query configured relays for:
   - `kind: 33357`;
   - `#p` equal to the logged-in pubkey;
   - `#app_pub` equal to this Flight Deck app pubkey;
   - `#protocol` equal to `onboarding`.
3. Decrypt candidate events.
4. Validate payload:
   - `type === "flightdeck_onboarding"`;
   - `version === 1`;
   - `protocol === "onboarding"`;
   - `recipient_npub` matches the logged-in user;
   - `app.app_pubkey` matches `#app_pub`;
   - `agent_connect.kind === "coworker_agent_connect"`;
   - `agent_connect.connection_token` is present.
5. Verify the workspace with Tower using NIP-98 before showing it as usable.
6. Import or stage the workspace through existing Agent Connect/workspace
   connection code.
7. Fetch current workspace records from Tower after verification.

Discovery failure must be diagnosable without making stale or rejected
workspaces look selectable.

## UI Requirements

### Sender Side

In the group/workspace access UI:

- show whether the recipient access grant was saved in Tower;
- show whether the `33357` relay announcement published;
- provide a retry action for announcement publish failure;
- provide a copy/share fallback message if relay publishing fails or the
  recipient is offline.

The share fallback is not an access grant. It should only tell the person to
open Flight Deck with their Nostr identity.

### Recipient Side

When a new verified onboarding event is found:

- show "New workspace available" or equivalent low-friction prompt;
- allow opening the workspace after Tower verification and initial metadata
  sync;
- keep stale/failed onboarding events out of the normal workspace switcher;
- expose stale/failed diagnostics in a recovery/debug surface.

## Suggested Files To Inspect

- `src/agent-connect.js`
- `src/connect-settings-manager.js`
- `src/workspace-manager.js`
- `src/workspaces.js`
- `src/pg-workspace-descriptor.js`
- `src/api.js`
- `src/auth/nostr.js`
- `src/app-identity.js`
- `src/shell-state.js`
- `src/app.js`
- `tests/connect-settings-manager.test.js`
- `tests/workspace-manager.test.js`
- `tests/workspaces.test.js`
- `tests/superbased-token.test.js`

The old files `src/nostr-trigger.js` and `src/triggers-manager.js` were deleted
in commit `851fa71` and must not be recreated for this feature.

## Acceptance

- Unit tests cover building a valid `33357` event:
  - kind is `33357`;
  - cleartext tags are only recipient/app/protocol routing tags;
  - `protocol` tag is `onboarding`;
  - `app_pub` is the app pubkey hex;
  - content is encrypted to the recipient;
  - no cleartext Tower URL, workspace name, connection token, scope name,
    channel name, or group list appears in tags.
- Unit tests cover encrypted payload validation:
  - valid payload carries `flightdeck_onboarding`;
  - `recipient_npub` mismatch is rejected;
  - `app.app_pubkey` mismatch is rejected;
  - missing `agent_connect.connection_token` is rejected;
  - stale `expires_at` is rejected.
- Unit tests cover publish-after-grant:
  - successful Tower grant triggers `33357` publish;
  - relay publish failure leaves Tower access intact and shows a recoverable
    warning;
  - retry publishes another valid announcement.
- Unit tests cover recipient discovery:
  - valid decrypted event verifies with Tower and imports/stages the workspace;
  - Tower rejection marks the event stale and does not show the workspace as
    selectable;
  - duplicate announcements deduplicate by recipient/app/workspace/grant id.
- Existing `33356` tests/docs remain valid.
- `rg "9256|nostr-trigger|triggers-manager|signAndPublishTrigger" src index.html tests`
  returns no active implementation references.
- `npm test -- --run <focused tests>` passes.
- `npm run build` passes and generated `dist` assets are committed if changed.
- Commit all relevant changes and leave `wm-fd-2` clean.

## Human Test

After implementation and app restart:

1. Log into Flight Deck as a workspace admin.
2. Add a second Nostr npub to a workspace/group.
3. Confirm Tower access is granted.
4. Confirm a kind `33357` event is published to relays with only safe cleartext
   tags.
5. Log in as the recipient in a clean browser/profile.
6. Confirm Flight Deck discovers the onboarding event, decrypts it, verifies
   with Tower, and offers the workspace.
7. Revoke access in Tower.
8. Confirm the old relay event no longer makes the workspace usable.
