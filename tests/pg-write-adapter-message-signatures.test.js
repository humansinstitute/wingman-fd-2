import { describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const pubkey = '1'.repeat(64);
  return {
    pubkey,
    createTowerPgChannelMessage: vi.fn(async (_workspaceId, channelId, body) => ({
      message: {
        id: 'message-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: channelId,
        thread_id: body.thread_id ?? 'thread-created-1',
        body: body.body,
        row_version: 1,
        created_by_actor_id: 'actor-1',
        updated_by_actor_id: 'actor-1',
        created_at: '2026-06-10T00:00:00.000Z',
        updated_at: '2026-06-10T00:00:00.000Z',
      },
      thread: null,
    })),
  };
});

vi.mock('../src/api.js', () => ({
  createTowerPgChannelAudioNote: vi.fn(),
  createTowerPgChannelDoc: vi.fn(),
  createTowerPgChannelFile: vi.fn(),
  createTowerPgChannelMessage: mockState.createTowerPgChannelMessage,
  createTowerPgChannelTask: vi.fn(),
  createTowerPgTaskComment: vi.fn(),
  deleteTowerPgDoc: vi.fn(),
  updateTowerPgDoc: vi.fn(),
  updateTowerPgTask: vi.fn(),
  updateTowerPgTaskState: vi.fn(),
}));

vi.mock('../src/auth/nostr.js', () => ({
  signNostrEvent: vi.fn(async (template) => ({
    ...template,
    id: '2'.repeat(64),
    pubkey: mockState.pubkey,
    sig: '3'.repeat(128),
  })),
}));

import { createTowerPgMessageFromLocal } from '../src/pg-write-adapter.js';

describe('createTowerPgMessageFromLocal', () => {
  it('sends a signed agent instruction with the PG chat message body', async () => {
    await createTowerPgMessageFromLocal({
      backendUrl: 'https://tower.example.com',
      session: { npub: 'npub1sender' },
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1workspace',
        appNpub: 'npub1app',
      },
    }, {
      channel_id: 'channel-1',
      body: 'Run this task',
    }, {
      threadId: 'thread-1',
    });

    expect(mockState.createTowerPgChannelMessage).toHaveBeenCalledTimes(1);
    const [, , requestBody] = mockState.createTowerPgChannelMessage.mock.calls[0];
    const signature = requestBody.message_signature;
    expect(requestBody.body).toBe('Run this task');
    expect(signature).toMatchObject({
      version: 1,
      protocol: 'flightdeck_pg_message_instruction',
      kind: 33358,
      nostr_event: {
        kind: 33358,
        pubkey: mockState.pubkey,
        content: 'Run this task',
      },
    });
    expect(signature.nostr_event.tags).toEqual(expect.arrayContaining([
      ['protocol', 'flightdeck_pg_message_instruction'],
      ['workspace_id', 'workspace-1'],
      ['channel_id', 'channel-1'],
      ['thread_id', 'thread-1'],
    ]));
  });
});
