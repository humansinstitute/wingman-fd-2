import { describe, expect, it } from 'vitest';
import {
  buildPgChannelTaskBoardId,
  buildPgThreadTaskBoardId,
  parsePgTaskBoardId,
  resolvePgRecordContext,
  resolvePgThreadId,
} from '../src/pg-record-context.js';

function store(seed = {}) {
  return {
    selectedBoardId: '',
    selectedChannelId: 'channel-1',
    channels: [
      { record_id: 'channel-1', scope_id: 'scope-1', record_state: 'active' },
      { record_id: 'channel-2', scope_id: 'scope-2', record_state: 'active' },
      { record_id: 'channel-3', scope_id: 'scope-3', record_state: 'active' },
    ],
    messages: [
      { record_id: 'message-1', channel_id: 'channel-1', pg_thread_id: 'thread-1' },
    ],
    ...seed,
  };
}

describe('PG record context', () => {
  it('round-trips PG channel and thread board ids', () => {
    expect(parsePgTaskBoardId(buildPgChannelTaskBoardId('channel-1'))).toEqual({
      type: 'channel',
      scopeId: null,
      channelId: 'channel-1',
      threadId: null,
    });
    expect(parsePgTaskBoardId(buildPgThreadTaskBoardId('channel-1', 'thread-1'))).toEqual({
      type: 'thread',
      scopeId: null,
      channelId: 'channel-1',
      threadId: 'thread-1',
    });
  });

  it('resolves scope from the selected channel and active PG thread from chat', () => {
    expect(resolvePgThreadId(store(), 'message-1')).toBe('thread-1');
    expect(resolvePgRecordContext(store(), {
      includeActiveThread: true,
      threadMessageId: 'message-1',
    })).toMatchObject({
      scopeId: 'scope-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
    });
  });

  it('uses a channel inside the requested scope instead of stale selected channel', () => {
    expect(resolvePgRecordContext(store(), { scopeId: 'scope-2' })).toMatchObject({
      scopeId: 'scope-2',
      channelId: 'channel-2',
    });
  });

  it('uses a channel inside the visible scope board instead of stale selected channel', () => {
    expect(resolvePgRecordContext(store({
      selectedBoardId: 'scope-3',
      selectedChannelId: 'channel-1',
    }))).toMatchObject({
      scopeId: 'scope-3',
      channelId: 'channel-3',
    });
  });

  it('rejects mismatched explicit channel and requested scope', () => {
    expect(() => resolvePgRecordContext(store(), { channelId: 'channel-1', scopeId: 'scope-2' }))
      .toThrow('Selected PG channel does not belong to the requested scope');
  });
});
