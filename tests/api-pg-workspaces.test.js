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
    await api.getTowerPgTaskComments('workspace-1', 'task-1', { appNpub: 'flightdeck_pg', limit: 70 });
    await api.getTowerPgChannelDocs('workspace-1', 'channel-1', { appNpub: 'flightdeck_pg', limit: 80 });
    await api.getTowerPgChannelFiles('workspace-1', 'channel-1', { appNpub: 'flightdeck_pg', limit: 90 });
    await api.getTowerPgChannelAudioNotes('workspace-1', 'channel-1', { appNpub: 'flightdeck_pg', limit: 100 });

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
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      7,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/tasks/task-1/comments?limit=70',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/tasks/task-1/comments?limit=70',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      8,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/docs?limit=80',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/docs?limit=80',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      9,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/files?limit=90',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/files?limit=90',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      10,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/audio-notes?limit=100',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/channels/channel-1/audio-notes?limit=100',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(10);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('creates Tower PG workspace scopes with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.createTowerPgWorkspaceScope('workspace-1', {
      name: 'Marketing',
      kind: 'project',
      description: 'Top-level marketing work area',
      owner_group_id: 'group-1',
    }, { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/scopes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'NIP98 POST https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/scopes',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
        body: JSON.stringify({
          name: 'Marketing',
          kind: 'project',
          description: 'Top-level marketing work area',
          owner_group_id: 'group-1',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(1);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('creates Tower PG task comments with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.createTowerPgTaskComment('workspace-1', 'task-1', {
      body: 'Task comment',
      thread_id: 'thread-1',
    }, { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/tasks/task-1/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'NIP98 POST https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/tasks/task-1/comments',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
        body: JSON.stringify({
          body: 'Task comment',
          thread_id: 'thread-1',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(1);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('creates admin Flight Deck PG workspaces with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.createTowerPgAdminWorkspace({
      workspace_name: 'Pete docs',
      workspace_description: 'PG workspace',
      app_npub: 'flightdeck_pg',
    }, { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tower.example/api/v4/admin/flightdeck-pg/workspaces',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'NIP98 POST https://tower.example/api/v4/admin/flightdeck-pg/workspaces',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
        body: JSON.stringify({
          workspace_name: 'Pete docs',
          workspace_description: 'PG workspace',
          app_npub: 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(1);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('calls Tower PG workspace admin group and member routes', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.getTowerPgWorkspaceMembers('workspace-1', { appNpub: 'flightdeck_pg', limit: 25 });
    await api.getTowerPgWorkspaceGroups('workspace-1', { appNpub: 'flightdeck_pg', limit: 26 });
    await api.createTowerPgWorkspaceMember('workspace-1', { member_npub: 'npub1member' }, { appNpub: 'flightdeck_pg' });
    await api.createTowerPgWorkspaceGroup('workspace-1', { name: 'Editors' }, { appNpub: 'flightdeck_pg' });
    await api.addTowerPgWorkspaceGroupMember('workspace-1', 'group-1', { member_npub: 'npub1member' }, { appNpub: 'flightdeck_pg' });
    await api.removeTowerPgWorkspaceGroupMember('workspace-1', 'group-1', 'actor-1', { appNpub: 'flightdeck_pg' });
    await api.addTowerPgWorkspaceChildGroup('workspace-1', 'parent-1', { child_group_id: 'child-1' }, { appNpub: 'flightdeck_pg' });
    await api.removeTowerPgWorkspaceChildGroup('workspace-1', 'parent-1', 'child-1', { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/members?limit=25',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/groups?limit=26',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/members',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/groups',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/groups/group-1/members',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      6,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/groups/group-1/members/actor-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      7,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/groups/parent-1/child-groups',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      8,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/groups/parent-1/child-groups/child-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(8);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });
});
