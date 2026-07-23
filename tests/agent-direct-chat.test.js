import { describe, expect, it } from 'vitest';
import {
  canonicalAgentMentionsFromSelection,
  readAgentChatConfig,
  writeAgentChatConfig,
} from '../src/agent-direct-chat.js';

describe('Agent Direct Chat contract helpers', () => {
  it('compatibly reads old prompts and writes only canonical agent_chat metadata', () => {
    expect(readAgentChatConfig({ basePrompt: 'Legacy context' })).toEqual({
      enabled: false,
      context_prompt: 'Legacy context',
      activation: 'mention_then_continue',
    });

    expect(writeAgentChatConfig({ basePrompt: 'Legacy', retained: true }, {
      enabled: true,
      context_prompt: '',
    })).toEqual({
      retained: true,
      agent_chat: {
        enabled: true,
        context_prompt: '',
        activation: 'mention_then_continue',
      },
    });
  });

  it('builds canonical actor mentions only from picker selections still present in the body', () => {
    const rick = 'npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz';
    const sam = `npub1${'q'.repeat(58)}`;
    expect(canonicalAgentMentionsFromSelection(
      `@Rick typed only @[Rick](mention:agent:${rick}) and @[Sam](mention:agent:${sam})`,
      [
        { type: 'agent', npub: rick, label: 'Rick' },
        { type: 'agent', npub: sam, label: 'Sam' },
      ],
    )).toEqual([
      { type: 'agent', npub: rick, label: 'Rick' },
      { type: 'agent', npub: sam, label: 'Sam' },
    ]);
    expect(canonicalAgentMentionsFromSelection('@Rick typed only', [
      { type: 'agent', npub: rick, label: 'Rick' },
    ])).toEqual([]);
    expect(canonicalAgentMentionsFromSelection(`@[Rick](mention:agent:${rick})`, [])).toEqual([]);
    expect(canonicalAgentMentionsFromSelection(
      `@[Rick](mention:person:${rick})`,
      [{ type: 'person', npub: rick, label: 'Rick' }],
    )).toEqual([{ type: 'person', npub: rick, label: 'Rick' }]);
  });
});
