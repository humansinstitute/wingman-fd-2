import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeader: vi.fn(async (requestUrl, method) => `NIP98 ${method} ${requestUrl}`),
  createNip98AuthHeaderForSecret: vi.fn(async (requestUrl, method) => `NIP98-SECRET ${method} ${requestUrl}`),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeySecretForAuth: vi.fn(() => new Uint8Array([1, 2, 3])),
  getActiveWorkspaceKeyNpub: vi.fn(() => 'npub1workspacekey'),
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  getActiveSessionNpub: vi.fn(() => 'npub1session'),
}));

describe('Tower PG API helpers', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (requestUrl) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, requestUrl }),
      text: async () => JSON.stringify({ ok: true, requestUrl }),
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls Tower PG descriptor and me routes with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.getTowerPgWorkspaceDescriptor('workspace-1', { appNpub: 'flightdeck_pg' });
    await api.getTowerPgWorkspaceMe('workspace-1', { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/me',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(2);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('lists Tower PG workspaces without encrypted workspace-key auth', async () => {
    const { createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.listTowerPgWorkspaces({ appNpub: 'flightdeck_pg', limit: 25 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces?app_npub=flightdeck_pg&limit=25',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces?app_npub=flightdeck_pg&limit=25',
        }),
      }),
    );
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('reads Tower PG scope, channel, thread, message, and task lists with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.getTowerPgWorkspaceScopes('workspace-1', { appNpub: 'flightdeck_pg', limit: 10 });
    await api.getTowerPgScopeChannels('workspace-1', 'scope-1', { appNpub: 'flightdeck_pg', limit: 20 });
    await api.getTowerPgChannelThreads('workspace-1', 'channel-1', { appNpub: 'flightdeck_pg', limit: 30 });
    await api.getTowerPgChannelMessages('workspace-1', 'channel-1', { appNpub: 'flightdeck_pg', limit: 40 });
    await api.getTowerPgChannelTasks('workspace-1', 'channel-1', { appNpub: 'flightdeck_pg', limit: 50 });
    await api.getTowerPgScopeTasks('workspace-1', 'scope-1', { appNpub: 'flightdeck_pg', limit: 60 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/scopes?limit=10',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/scopes?limit=10',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/scopes/scope-1/channels?limit=20',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/scopes/scope-1/channels?limit=20',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/threads?limit=30',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/threads?limit=30',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/messages?limit=40',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/messages?limit=40',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/tasks?limit=50',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/tasks?limit=50',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      6,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/scopes/scope-1/tasks?limit=60',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/scopes/scope-1/tasks?limit=60',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(6);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });
});
