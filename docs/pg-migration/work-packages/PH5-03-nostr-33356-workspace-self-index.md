# PH5-03 Nostr 33356 Workspace Self-Index

## Workdir

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Supporting Docs

- `docs/33356-workspace-self-index.md`
- `docs/33357-onboard.md`
- `docs/pg-migration/architecture.md`
- `docs/pg-migration/status.md`
- `docs/pg-migration/work-packages/COMPLETED-PH1-02-pg-auth-and-workspace-connection.md`

## Scope

Implement Flight Deck PG workspace self-index discovery using Nostr kind
`33356`.

This is the cross-device "my workspaces follow my Nostr login" slice:

- After a user verifies/connects to a PG workspace, publish or refresh one
  encrypted kind `33356` self-index event for that workspace.
- On login/startup, query configured relays for the user's `33356` self-index
  events, decrypt them, verify each workspace with Tower, and merge verified
  workspaces into `knownWorkspaces`.
- Use Tower as the authority. Relay events are only discovery hints.

## Explicit Non-Scope

- Do not change the kind `33357` event format, protocol string, payload shape,
  Agent Connect payload, or connection-token semantics.
- Do not edit `docs/33357-onboard.md` unless the only change is adding a
  non-semantic cross-reference approved by the orchestrator. The worker must
  verify `git diff -- docs/33357-onboard.md` is empty before handoff.
- Do not implement `33357` onboarding retrieval in this ticket.
- Do not add bearer tokens, connection tokens, database credentials, or workspace
  secrets to PG `33356` payloads.
- Do not reintroduce encrypted-record sync or workspace application keys for PG
  workspace discovery.
- Do not modify Tower unless a small typed metadata endpoint is truly required
  and cannot be avoided. The expected implementation is browser-side in
  `wm-fd-2`.

## Required Behaviour

### Publish

When PG workspace verification succeeds through manual descriptor/Tower URL,
workspace creation, or a successful descriptor import:

1. Build a credential-free `wingman_workspace_locator` payload from the verified
   workspace descriptor.
2. Wrap it in the `flightdeck_workspace_self_index` payload described in
   `docs/33356-workspace-self-index.md`.
3. Encrypt the payload to the logged-in user's own pubkey.
4. Publish a parameterized replaceable kind `33356` event to configured relays.
5. Record local publish state for the workspace:
   - local-only;
   - indexed;
   - failed, with a useful error.

Publishing failure must not block local workspace use.

### Login Discovery

On login/startup with a Nostr signer:

1. Query configured relays for kind `33356` where:
   - author is the logged-in pubkey;
   - `#p` is the logged-in pubkey;
   - `#app_pub` matches this Flight Deck app pubkey;
   - `#protocol` is `workspace-self-index`.
2. Decrypt and validate each payload.
3. Ignore deleted/tombstoned locators.
4. Deduplicate by app pubkey, Tower service npub, workspace id, and workspace
   service npub.
5. Verify each candidate with Tower `/descriptor` and `/me` using NIP-98.
6. Merge verified workspaces into `knownWorkspaces`.
7. Hide or mark stale locators rejected by Tower.

Discovery must not require the user to paste a Tower URL when a verified
`33356` locator already contains the Tower base URL.

### Encryption And Relays

- Prefer NIP-44 if the signer/runtime supports it.
- Fall back to NIP-04 only if current project support makes NIP-44 unavailable.
- If encryption-to-self is unavailable, keep local-only state and expose a
  recoverable warning instead of failing workspace connection.
- Use the app's existing Nostr/relay dependencies and patterns where possible.
- The cleartext event must not expose Tower URL, workspace label, workspace id,
  scope names, channel names, tokens, or credentials except through opaque tags.

## Acceptance

- Existing kind `33357` tests/docs/format remain unchanged.
- `git diff -- docs/33357-onboard.md` is empty at handoff.
- Unit tests cover building a kind `33356` event:
  - kind is `33356`;
  - `protocol` tag is `workspace-self-index`;
  - one deterministic opaque `d` tag is generated per workspace identity;
  - cleartext tags do not include workspace labels or Tower URLs;
  - encrypted payload contains a credential-free `wingman_workspace_locator`.
- Unit tests cover publish-after-verified-PG-workspace:
  - successful publish marks workspace indexed;
  - publish failure leaves workspace usable and marks self-index failed/local.
- Unit tests cover login discovery:
  - valid decrypted `33356` locator verifies through Tower and merges into
    `knownWorkspaces`;
  - Tower `/me` rejection marks/hides stale locator;
  - deleted/tombstoned locators are ignored;
  - duplicate events deduplicate by workspace identity.
- Existing PG workspace connection tests continue to pass.
- `bun run build` passes and generated dist assets are committed if they change.
- Commit all relevant changes and leave `wm-fd-2` clean.

## Suggested Files To Inspect

- `src/workspace-manager.js`
- `src/connect-settings-manager.js`
- `src/pg-workspace-descriptor.js`
- `src/api.js`
- `src/shell-state.js`
- `src/app.js`
- existing Nostr helper usage in the repo after `851fa71 Remove legacy Nostr
  workflow triggers`
- existing tests:
  - `tests/pg-workspace-manager.test.js`
  - `tests/pg-connect-settings-manager.test.js`
  - `tests/connect-settings-manager.test.js`
  - `tests/workspace-manager.test.js`
  - `tests/api-pg-workspaces.test.js`

## Human Test

After implementation and app restart:

1. Log into Flight Deck PG with a Nostr identity.
2. Connect to a PG workspace manually.
3. Confirm the workspace opens even if relay publish fails.
4. Confirm successful relay publish marks the workspace indexed.
5. Clear local browser state or use a second browser/device with the same Nostr
   identity.
6. Log in.
7. Confirm the workspace is discovered from `33356`, verified with Tower, and
   appears without manually entering the Tower URL.
