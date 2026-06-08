import { beforeEach, describe, expect, it, vi } from 'vitest';

const querySync = vi.fn();
const close = vi.fn();
const cacheProfile = vi.fn();

vi.mock('../src/db.js', () => ({
  cacheProfile,
  getCachedProfile: vi.fn(() => null),
}));

vi.mock('nostr-tools', () => ({
  nip19: {
    decode: vi.fn(() => ({ type: 'npub', data: 'hex-pubkey' })),
  },
  SimplePool: vi.fn(() => ({
    querySync,
    close,
  })),
}));

describe('fetchProfileByNpub', () => {
  beforeEach(() => {
    querySync.mockReset();
    close.mockReset();
    cacheProfile.mockReset();
  });

  it('queries common metadata relays beyond the default pair', async () => {
    querySync.mockResolvedValue([
      {
        created_at: 10,
        content: JSON.stringify({ name: 'Pete Winn', picture: 'https://example.com/avatar.png' }),
      },
    ]);

    const { fetchProfileByNpub } = await import('../src/profiles.js');
    await fetchProfileByNpub('npub1example');

    const queriedRelays = querySync.mock.calls[0][0];
    expect(queriedRelays).toEqual([
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://proxy.nostr-relay.app/8c5723f2601334234e1922d2e842d6bbf209283b07120b3f1d38660915f13793',
      'ws://127.0.0.1:4869',
    ]);
    expect(queriedRelays).toContain('wss://relay.damus.io');
    expect(queriedRelays).toContain('wss://relay.primal.net');
  });
});
