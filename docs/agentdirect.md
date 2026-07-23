# Agent Direct Chat: Flight Deck MVP Design

## Purpose

Agent Direct Chat lets a person begin and continue a normal Flight Deck chat with a Wingman agent. A person mentions an agent such as Rick in a channel thread; Autopilot opens a normal agent session for that thread, gives it the channel and thread context, and publishes its answer back through Tower as an ordinary Flight Deck message. Later human replies in the same thread continue the same agent conversation without launching a pipeline.

This is a direct conversational transport, not a task dispatch, flow dispatch, pipeline run, generic record post, or browser-to-Autopilot connection.

The MVP user experience is:

1. A channel includes an agent actor and has Agent Direct Chat enabled.
2. A human starts or replies to a thread and canonically mentions that agent.
3. Flight Deck writes the message and structured mention to Tower.
4. Tower emits the normal typed message event.
5. Autopilot creates or resumes one session for the workspace/channel/thread/agent tuple.
6. Autopilot publishes the agent answer to Tower through the typed message API.
7. Flight Deck renders the answer as an ordinary message authored by the agent.
8. Further human messages in the activated thread continue the bound session without another mention.

## System Ownership

- Flight Deck owns the human interface, channel configuration, mention authoring, and rendering.
- Tower owns workspace authorization, canonical chat records, agent identity, message events, ordered thread reads, and idempotent message writes.
- Autopilot owns agent routing, local project resolution, session creation/resume, prompt delivery, response parsing, and reply publication.

Flight Deck must not call an Autopilot instance directly. This allows a hosted Flight Deck to work with agents running on customer-owned Wingman machines.

## MVP Scope

Flight Deck must provide:

- a stable channel-level Agent Direct Chat configuration;
- canonical structured agent mentions on messages;
- ordinary Tower PG message creation for human turns;
- ordinary rendering of agent-authored Tower PG messages;
- no self-triggering browser behavior when an agent reply arrives.

The MVP does not require:

- an ACP client in Flight Deck;
- pipeline selection or execution;
- browser knowledge of an Autopilot URL or session ID;
- a full project/directory configuration UI;
- typing/activity indicators;
- a visible session inspector or End Conversation control.

## Channel Configuration

Use the Tower PG channel record as the source of truth. For the MVP, store the configuration under validated channel metadata unless Tower introduces typed columns in the same change:

```json
{
  "agent_chat": {
    "enabled": true,
    "context_prompt": "You are helping with the Wingman Be Free project.",
    "activation": "mention_then_continue"
  }
}
```

Field semantics:

- `enabled`: permits Agent Direct Chat routing in the channel.
- `context_prompt`: durable channel-specific context supplied to a newly created or recovery session.
- `activation`: for the MVP, the only supported value is `mention_then_continue`.

`mention_then_continue` means the first routed human message must mention the agent. Once Autopilot has a binding for the thread and agent, later human messages in that thread do not require another mention.

The existing channel context prompt UI should read and write this canonical location. If an older field such as `basePrompt` or `contextPrompt` currently exists, implement an explicit compatibility read and migrate writes to the canonical `metadata.agent_chat.context_prompt` contract agreed with Tower. Do not maintain two independently editable prompts.

## Canonical Agent Mentions

Visible `@Rick` text is not sufficient for routing. The message create request must contain structured mention metadata:

```json
{
  "body": "@Rick can you review this design?",
  "thread_id": "<thread-id>",
  "metadata": {
    "mentions": [
      {
        "type": "agent",
        "npub": "npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz",
        "label": "Rick"
      }
    ]
  }
}
```

Implementation rules:

- populate mentions from the selected workspace actor, never by parsing arbitrary message text;
- use the actor's canonical npub and `type: "agent"`;
- preserve all mentions when a message mentions more than one actor;
- keep visible mention text for human readability;
- do not accept typed text that merely resembles `@Rick` as a canonical mention;
- send the message only through the typed Tower Flight Deck PG API;
- preserve existing attachment, thread, and reply behavior.

Tower validates identity and access. Flight Deck should still restrict the picker to agents visible in the workspace/channel so the user gets immediate, understandable choices.

## Message and Thread Behavior

### Starting a conversation

A root message or thread reply may activate Agent Direct Chat. Flight Deck writes the normal message with:

- workspace resolved from the current PG workspace context;
- scope and channel resolved from the visible channel;
- the canonical thread ID;
- structured mention metadata;
- the signed-in human as the author.

No separate invocation record is created.

### Receiving an agent reply

Autopilot signs a typed Tower PG message request using the agent identity. Tower determines the author from the signer. Flight Deck receives that message through its existing SSE/materialization path and renders it like other chat messages.

Message metadata may contain provenance:

```json
{
  "source": "autopilot_session",
  "session_id": "<session-id>",
  "turn_id": "<turn-id>",
  "source_message_ids": ["<human-message-id>"]
}
```

This metadata is descriptive. It must not override Tower's authenticated author.

### Continuing a conversation

Flight Deck does not decide whether a thread is activated. It writes later human replies normally. Autopilot's persisted binding decides whether they are routed. This avoids requiring browser-local state and makes continuation work across devices and Flight Deck reloads.

### Loop prevention

Flight Deck performs no automatic dispatch on received messages. Autopilot is responsible for suppressing messages authored by the target agent or its mapped workspace key. Flight Deck must preserve returned author fields and mention metadata so that suppression is reliable.

## UI Changes

### Required

1. Ensure the composer mention picker can select an agent actor and emits canonical mention metadata.
2. Add or adapt channel settings for:
   - Enable Agent Direct Chat;
   - Channel context prompt.
3. Explain the activation behavior near the setting: "Mention an agent once to start; replies in that thread continue the conversation."
4. Render returned agent messages without a special result card or pipeline UI.

### Deferred

- agent working/failed activity state;
- associated session link;
- project/profile selector;
- per-agent activation policy;
- End Conversation and Restart Conversation actions;
- support for requiring a mention on every turn.

## API Expectations

Flight Deck depends on Tower providing:

- channel reads and updates that preserve validated `agent_chat` configuration;
- message create accepting canonical mentions and an optional client request ID;
- thread reads returning author identity, mentions, attachments, timestamps, and stable message IDs;
- visible events for created messages;
- agent NIP-98 message creation with normal channel authorization.

Flight Deck does not depend on Autopilot APIs.

## Single Implementation Work Package

Implement this MVP as one Flight Deck work package named **Agent Direct Chat: Flight Deck surface and canonical mentions**. Assign the complete package to one worker/session in this repository. Do not split channel settings, mention serialization, message hydration, and tests into separate independently handed-off tasks: they form one user-visible browser contract and must be reviewed together.

### Package objective

Make Flight Deck author and render the Tower-side Agent Direct Chat contract without knowing or calling Autopilot.

### Prerequisites

- The Tower request/response shapes for `metadata.agent_chat`, normalized mentions, and message creation are agreed and represented in this document.
- The implementation may begin against fixtures/mocks before Tower is deployed, but final acceptance requires the live Tower contract.

### Included work

- normalize channel Agent Direct Chat configuration and compatibility reads;
- add the enable control and channel context prompt UI;
- retain canonical agent mention identity from picker selection through message creation;
- send normalized mention metadata through the Tower PG write path;
- preserve mention, author, provenance, and thread data through hydration/materialization;
- render the resulting agent-authored message as ordinary chat;
- add focused tests and update the production build output.

### Explicit exclusions

- no Autopilot API calls or session state in the browser;
- no pipeline or invocation launch;
- no project-directory selector;
- no working indicator, session inspector, or End Conversation UI;
- no ACP implementation.

### Deliverables

- source and template changes implementing the included work;
- focused automated coverage for settings and mention round-tripping;
- regenerated `dist/` from the normal build;
- any fixture/translator updates required by the final Tower contract;
- a handoff stating the Tower contract version/commit used for integration.

### Validation and definition of done

Run focused tests while developing, then run the repository's full test and build commands. The package is done only when all Flight Deck acceptance tests below pass, the production build is current, no browser-to-Autopilot path exists, and the integrated mention-to-agent-reply vertical slice has been exercised against compatible Tower and Autopilot builds.

## Implementation Directions

1. Identify the canonical Tower PG channel metadata translation in `src/translators/` and channel settings logic in `src/channels-manager.js`.
2. Add a single normalized helper for reading/writing `metadata.agent_chat` so UI code does not spread compatibility rules.
3. Extend the composer mention model to retain `{ type, npub, label }` for selected agent actors.
4. Extend the PG write adapter/message create payload to send the structured `metadata.mentions` array without dropping existing metadata.
5. Ensure message hydration/materialization preserves returned metadata and agent author fields.
6. Add channel settings controls and validation. An empty context prompt is valid.
7. Do not add an Autopilot fetch, pipeline launch, invocation creation, or local session binding.
8. Add focused tests, then build the app so `dist/` matches source for the implementation change.

Likely implementation areas include:

- `src/channels-manager.js`;
- the chat composer/message creation logic in `src/app.js` or its extracted manager;
- `src/pg-write-adapter.js`;
- `src/pg-read-hydrator.js` and message translators if metadata is currently narrowed;
- channel and chat templates in `index.html`;
- focused Vitest coverage under `tests/`.

The implementer must confirm exact live paths before editing; this document defines behavior, not a mandatory file decomposition.

## Acceptance Tests

1. Enabling Agent Direct Chat persists after reload and on another browser using the same workspace.
2. The channel context prompt round-trips without falling back to a second editable field.
3. Selecting Rick in the mention picker sends a canonical agent mention with Rick's npub.
4. Typing literal `@Rick` without selecting a mention does not produce canonical mention metadata.
5. Root messages and thread replies preserve the correct Tower workspace, scope, channel, and thread IDs.
6. Agent-authored Tower messages appear in the correct thread with the agent identity.
7. Agent replies do not invoke a Flight Deck pipeline or browser-side Autopilot request.
8. Existing human mentions, attachments, editing, and ordinary chat behavior continue to work.
9. The production build succeeds and generated `dist/` is updated with the implementation.

## Cross-Project Delivery Contract

The vertical slice is complete only when this sequence passes against the three projects together:

```text
Flight Deck creates a human message with a canonical Rick mention
→ Tower persists it and emits a visible message event
→ Autopilot creates a normal Rick session
→ Autopilot returns a parsed answer through Tower's message API
→ Flight Deck renders exactly one ordinary Rick-authored reply
→ a later unmentioned human reply continues the same bound session
```

See the corresponding `docs/agentdirect.md` documents in Autopilot and Tower for the runtime and backend designs.
