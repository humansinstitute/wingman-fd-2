import { beforeEach, describe, expect, it, vi } from 'vitest';

const querySync = vi.fn();
const close = vi.fn();
const cacheProfile = vi.fn();
const getCachedProfile = vi.fn(() => null);

vi.mock('../src/db.js', () => ({
  cacheProfile,
  getCachedProfile,
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
    getCachedProfile.mockReset();
    getCachedProfile.mockResolvedValue(null);
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
      'wss://relay.primal.net',
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://purplepag.es',
    ]);
    expect(queriedRelays).toContain('wss://relay.damus.io');
    expect(queriedRelays).toContain('wss://relay.primal.net');
  });

  it('bypasses the local profile cache when forced', async () => {
    getCachedProfile.mockResolvedValue({ name: 'Cached Name' });
    querySync.mockResolvedValue([
      {
        created_at: 20,
        content: JSON.stringify({ name: 'Fresh Name' }),
      },
    ]);

    const { fetchProfileByNpub } = await import('../src/profiles.js');
    const profile = await fetchProfileByNpub('npub1example', { force: true });

    expect(getCachedProfile).not.toHaveBeenCalled();
    expect(querySync).toHaveBeenCalled();
    expect(profile.name).toBe('Fresh Name');
  });
});
