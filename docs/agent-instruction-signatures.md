# Agent Instruction Signatures

PG chat messages may be consumed by Autopilot agents. Flight Deck must attach a
signed instruction to every Tower PG chat write so downstream systems can prove
the user wrote the body that the agent is about to act on.

For each `POST /api/v4/flightdeck-pg/workspaces/:workspaceId/channels/:channelId/messages`
request, Flight Deck sends `message_signature` with:

- `version: 1`
- `protocol: "flightdeck_pg_message_instruction"`
- `kind: 33358`
- `signer_npub`
- `body_sha256`
- `nostr_event`

The nested Nostr event is signed by the active logged-in Nostr user. Its
`content` is the exact message body sent to Tower. Its tags include
`protocol`, `body_sha256`, `workspace_id`, and `channel_id`; thread replies also
include `thread_id`.

Tower rejects unsigned or invalid messages. Autopilot independently rechecks the
stored signature before dispatching an agent pipeline. This makes the browser
message body the minimum signed instruction and prevents another workspace actor
or storage layer from changing the instruction before an agent acts.
