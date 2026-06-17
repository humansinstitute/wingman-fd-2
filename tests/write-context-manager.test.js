import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => true),
}));

import { isTowerPgBackendMode } from '../src/backend-mode.js';
import { writeContextManagerMixin } from '../src/write-context-manager.js';

function createStore(overrides = {}) {
  const store = {
    selectedBoardId: '__all__',
    selectedChannelId: 'channel-1',
    channels: [
      { record_id: 'channel-1', scope_id: 'scope-1', title: 'General', record_state: 'active' },
    ],
    ...overrides,
  };
  Object.defineProperties(store, Object.getOwnPropertyDescriptors(writeContextManagerMixin));
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  isTowerPgBackendMode.mockReturnValue(true);
});

describe('write context manager', () => {
  it('does not reuse a stale selected channel when the board is All', () => {
    const store = createStore();

    expect(store.resolvePgWriteContext()).toBeNull();
  });

  it('resolves an explicit channel even when the board is All', () => {
    const store = createStore();

    expect(store.resolvePgWriteContext({ channelId: 'channel-1' })).toMatchObject({
      scopeId: 'scope-1',
      channelId: 'channel-1',
    });
  });

  it('prompts for a channel when the visible board is scope Home', () => {
    const store = createStore({
      selectedBoardId: 'scope-1',
      selectedChannelId: 'channel-1',
    });

    expect(store.resolvePgWriteContext()).toBeNull();
  });

  it('sends pending messages after the user chooses a channel', async () => {
    const sendMessage = vi.fn().mockResolvedValue('sent');
    const selectPgChannelContext = vi.fn();
    const store = createStore({
      showWriteContextModal: true,
      writeContextPendingAction: { type: 'message', payload: { options: {} } },
      writeContextScopeId: 'scope-1',
      writeContextChannelId: 'channel-1',
      writeContextError: '',
      writeContextSubmitting: false,
      sendMessage,
      selectPgChannelContext,
    });

    await expect(store.confirmWriteContextModal()).resolves.toBe('sent');
    expect(selectPgChannelContext).toHaveBeenCalledWith('channel-1');
    expect(sendMessage).toHaveBeenCalledWith({ scopeId: 'scope-1', channelId: 'channel-1' });
    expect(store.showWriteContextModal).toBe(false);
  });

  it('infers the write scope from the selected channel', () => {
    const store = createStore({
      writeContextScopeId: '',
      writeContextChannelId: '',
    });

    store.selectWriteContextChannel('channel-1');

    expect(store.writeContextChannelId).toBe('channel-1');
    expect(store.writeContextScopeId).toBe('scope-1');
  });
});
