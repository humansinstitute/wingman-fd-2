import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  alpineStartMock,
  alpineStoreMock,
} = vi.hoisted(() => ({
  alpineStartMock: vi.fn(),
  alpineStoreMock: vi.fn(),
}));

vi.mock('alpinejs', () => ({
  default: {
    store: alpineStoreMock,
    start: alpineStartMock,
  },
}));

beforeEach(() => {
  alpineStartMock.mockClear();
  alpineStoreMock.mockClear();
});

async function createStore() {
  vi.resetModules();
  const { initApp } = await import('../src/app.js');
  initApp();
  const store = alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
  expect(store).toBeTruthy();
  return store;
}

describe('channel mention lookup', () => {
  it('returns all active channels for the channel prefix', async () => {
    const store = await createStore();
    store.channels = Array.from({ length: 12 }, (_, index) => ({
      record_id: `channel-${index + 1}`,
      title: `Channel ${index + 1}`,
      record_state: 'active',
    })).concat({
      record_id: 'channel-deleted',
      title: 'Deleted channel',
      record_state: 'deleted',
    });
    store.getChannelLabel = (channel) => channel.title;

    const results = store.searchMentions('channel:');

    expect(results).toHaveLength(12);
    expect(results.every((result) => result.type === 'channel')).toBe(true);
    expect(results.map((result) => result.label)).toContain('Channel 12');
    expect(results.map((result) => result.label)).not.toContain('Deleted channel');
  });

  it('matches channel names in the general mention lookup', async () => {
    const store = await createStore();
    store.channels = [
      { record_id: 'channel-ops', title: 'Operations', record_state: 'active' },
      { record_id: 'channel-sales', title: 'Sales', record_state: 'active' },
    ];
    store.getChannelLabel = (channel) => channel.title;

    expect(store.searchMentions('oper')).toEqual([{
      type: 'channel',
      id: 'channel-ops',
      label: 'Operations',
      sublabel: 'Channel',
    }]);
  });

  it('navigates channel mentions to the selected chat channel', async () => {
    const store = await createStore();
    store.navSection = 'tasks';
    store.mobileNavOpen = true;
    store.startWorkspaceLiveQueries = vi.fn();
    store.selectChannel = vi.fn();

    store.handleMentionNavigate('channel', 'channel-ops');

    expect(store.navSection).toBe('chat');
    expect(store.mobileNavOpen).toBe(false);
    expect(store.startWorkspaceLiveQueries).toHaveBeenCalledTimes(1);
    expect(store.selectChannel).toHaveBeenCalledWith('channel-ops');
  });
});
