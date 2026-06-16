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
});
