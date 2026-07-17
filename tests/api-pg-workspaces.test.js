import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeader: vi.fn(async (requestUrl, method) => `NIP98 ${method} ${requestUrl}`),
  createNip98AuthHeaderForSecret: vi.fn(async (requestUrl, method) => `NIP98-SECRET ${method} ${requestUrl}`),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeySecretForAuth: vi.fn(() => null),
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
    vi.useRealTimers();
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

  it('updates Tower PG file metadata with PATCH auth', async () => {
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.updateTowerPgFile('workspace-1', 'file-1', {
      row_version: 3,
      channel_id: 'channel-2',
    }, { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/files/file-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'NIP98 PATCH https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/files/file-1',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
        body: JSON.stringify({
          row_version: 3,
          channel_id: 'channel-2',
        }),
      }),
    );
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

  it('updates Tower PG workspace profile metadata with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.updateTowerPgWorkspace('workspace-1', {
      name: 'Testing Space',
      slug: 'testing-space',
      description: 'Workspace profile',
      avatar_url: null,
    }, { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'NIP98 PATCH https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          name: 'Testing Space',
          slug: 'testing-space',
          description: 'Workspace profile',
          avatar_url: null,
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(1);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('calls Tower PG workroom list, create, detail, and lifecycle routes', async () => {
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.searchTowerPgWorkrooms('workspace-1', {
      query: 'release',
      scopeId: 'scope-1',
      channelId: 'channel-1',
      limit: 20,
      appNpub: 'flightdeck_pg',
    });
    await api.getTowerPgWorkrooms('workspace-1', {
      channelId: 'channel-1',
      status: 'active',
      limit: 25,
      appNpub: 'flightdeck_pg',
    });
    await api.createTowerPgWorkroom('workspace-1', {
      channel_id: 'channel-1',
      title: 'Release room',
      goal: 'Ship safely',
    }, { appNpub: 'flightdeck_pg' });
    await api.getTowerPgWorkroom('workspace-1', 'room-1', { limit: 50, appNpub: 'flightdeck_pg' });
    await api.updateTowerPgWorkroom('workspace-1', 'room-1', {
      title: 'Release room v2',
      row_version: 1,
    }, { appNpub: 'flightdeck_pg' });
    await api.startTowerPgWorkroom('workspace-1', 'room-1', { row_version: 2 }, { appNpub: 'flightdeck_pg' });
    await api.archiveTowerPgWorkroom('workspace-1', 'room-1', { row_version: 3 }, { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/search?q=release&scope_id=scope-1&channel_id=channel-1&limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms?channel_id=channel-1&status=active&limit=25',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channel_id: 'channel-1',
          title: 'Release room',
          goal: 'Ship safely',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Release room v2', row_version: 1 }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      6,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/start',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ row_version: 2 }) }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      7,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/archive',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ row_version: 3 }) }),
    );
  });

  it('calls Tower PG workroom child and approval routes', async () => {
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.getTowerPgWorkroomParticipants('workspace-1', 'room-1', { appNpub: 'flightdeck_pg' });
    await api.createTowerPgWorkroomParticipant('workspace-1', 'room-1', {
      actor_npub: 'npub1reviewer',
      role: 'human_approver',
    }, { appNpub: 'flightdeck_pg' });
    await api.updateTowerPgWorkroomParticipant('workspace-1', 'room-1', 'participant-1', {
      access_status: 'granted',
    }, { appNpub: 'flightdeck_pg' });
    await api.getTowerPgWorkroomEvents('workspace-1', 'room-1', { limit: 10, appNpub: 'flightdeck_pg' });
    await api.createTowerPgWorkroomEvent('workspace-1', 'room-1', {
      event_type: 'note',
      title: 'Ready',
    }, { appNpub: 'flightdeck_pg' });
    await api.getTowerPgWorkroomLinks('workspace-1', 'room-1', { limit: 15, appNpub: 'flightdeck_pg' });
    await api.createTowerPgWorkroomLink('workspace-1', 'room-1', {
      link_type: 'pull_request',
      target_type: 'external',
      external_url: 'https://github.example/pr/1',
    }, { appNpub: 'flightdeck_pg' });
    await api.createTowerPgWorkroomApproval('workspace-1', 'room-1', {
      action: 'production_merge',
      metadata: { to_branch: 'main', commit: 'abc123' },
    }, { appNpub: 'flightdeck_pg' });
    await api.getTowerPgApprovals('workspace-1', {
      targetType: 'workroom',
      targetId: 'room-1',
      status: 'requested',
      appNpub: 'flightdeck_pg',
    });
    await api.getTowerPgApproval('workspace-1', 'approval-1', { appNpub: 'flightdeck_pg' });
    await api.decideTowerPgApproval('workspace-1', 'approval-1', {
      status: 'approved',
      row_version: 1,
    }, { appNpub: 'flightdeck_pg' });
    await api.checkTowerPgProductionMergeApproval('workspace-1', 'room-1', {
      to_branch: 'main',
      commit: 'abc123',
    }, { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/participants',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/participants',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ actor_npub: 'npub1reviewer', role: 'human_approver' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/participants/participant-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ access_status: 'granted' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/events?limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/events',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event_type: 'note', title: 'Ready' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      6,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/links?limit=15',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      7,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/links',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          link_type: 'pull_request',
          target_type: 'external',
          external_url: 'https://github.example/pr/1',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      8,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/approvals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'production_merge',
          metadata: { to_branch: 'main', commit: 'abc123' },
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      9,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/approvals?target_type=workroom&target_id=room-1&status=requested&limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      10,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/approvals/approval-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      11,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/approvals/approval-1/decision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ status: 'approved', row_version: 1 }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      12,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/workrooms/room-1/production-merge/check',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to_branch: 'main', commit: 'abc123' }),
      }),
    );
  });

  it('reads Tower PG document metadata and body with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.getTowerPgDoc('workspace-1', 'doc-1', { appNpub: 'flightdeck_pg' });
    await api.getTowerPgDocBody('workspace-1', 'doc-1', { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/body',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/body',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(2);
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

  it('calls Tower PG edit lease acquire, renew, and release routes', async () => {
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.acquireTowerPgEditLease('workspace-1', {
      entity_type: 'task',
      entity_id: 'task-1',
    }, { appNpub: 'flightdeck_pg' });
    await api.renewTowerPgEditLease('workspace-1', 'lease-1', {
      lease_token: 'token-1',
    }, { appNpub: 'flightdeck_pg' });
    await api.releaseTowerPgEditLease('workspace-1', 'lease-1', {
      lease_token: 'token-1',
    }, { appNpub: 'flightdeck_pg' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/edit-leases/acquire',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ entity_type: 'task', entity_id: 'task-1' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/edit-leases/lease-1/renew',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ lease_token: 'token-1' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/edit-leases/lease-1/release',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ lease_token: 'token-1' }),
      }),
    );
  });

  it('reads and creates Tower PG document comments with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.getTowerPgDocComments('workspace-1', 'doc-1', {
      appNpub: 'flightdeck_pg',
      limit: 40,
    });
    await api.getTowerPgDocVersions('workspace-1', 'doc-1', {
      appNpub: 'flightdeck_pg',
      limit: 20,
    });
    await api.createTowerPgDocComment('workspace-1', 'doc-1', {
      body: 'Doc comment',
      parent_comment_id: 'comment-1',
      metadata: {
        anchor_block_id: 'block-1',
        anchor_line_number: 4,
      },
    }, { appNpub: 'flightdeck_pg' });
    await api.updateTowerPgDocComment('workspace-1', 'doc-1', 'comment-1', {
      comment_status: 'resolved',
      row_version: 2,
    }, { appNpub: 'flightdeck_pg' });
    await api.deleteTowerPgDocComment('workspace-1', 'doc-1', 'comment-1', {
      appNpub: 'flightdeck_pg',
      rowVersion: 3,
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/comments?limit=40',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/comments?limit=40',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/versions?limit=20',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/versions?limit=20',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'NIP98 POST https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/comments',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
        body: JSON.stringify({
          body: 'Doc comment',
          parent_comment_id: 'comment-1',
          metadata: {
            anchor_block_id: 'block-1',
            anchor_line_number: 4,
          },
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/comments/comment-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'NIP98 PATCH https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/comments/comment-1',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
        body: JSON.stringify({
          comment_status: 'resolved',
          row_version: 2,
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/comments/comment-1?row_version=3',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'NIP98 DELETE https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/docs/doc-1/comments/comment-1?row_version=3',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(5);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('reads Tower PG Daily Scope versions with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.getTowerPgDailyNoteVersions('workspace-1', 'daily-1', {
      appNpub: 'flightdeck_pg',
      limit: 25,
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/daily-notes/daily-1/versions?limit=25',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'NIP98 GET https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/daily-notes/daily-1/versions?limit=25',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(1);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('upserts Tower PG Daily Scope with the active workspace key signer', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const { getActiveWorkspaceKeySecretForAuth } = await import('../src/crypto/workspace-keys.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');
    const workspaceSecret = new Uint8Array([4, 5, 6]);
    getActiveWorkspaceKeySecretForAuth.mockReturnValueOnce(workspaceSecret);
    const body = {
      note_date: '2026-06-24',
      title: 'Daily note',
      body: 'Mobile note',
      items: [],
      status: 'active',
    };

    await api.upsertTowerPgDailyNote('workspace-1', body, {
      appNpub: 'flightdeck_pg',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/daily-notes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'NIP98-SECRET POST https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/daily-notes',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
        body: JSON.stringify(body),
      }),
    );
    expect(createNip98AuthHeaderForSecret).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/daily-notes',
      'POST',
      body,
      workspaceSecret,
    );
    expect(createNip98AuthHeader).not.toHaveBeenCalled();
  });

  it('deletes Tower PG messages and threads with browser NIP-98 auth', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');

    await api.deleteTowerPgMessage('workspace-1', 'message-1', {
      appNpub: 'flightdeck_pg',
      rowVersion: 3,
    });
    await api.deleteTowerPgThread('workspace-1', 'thread-1', {
      appNpub: 'flightdeck_pg',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/messages/message-1?row_version=3',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'NIP98 DELETE https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/messages/message-1?row_version=3',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/threads/thread-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'NIP98 DELETE https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/threads/thread-1',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeader).toHaveBeenCalledTimes(2);
    expect(createNip98AuthHeaderForSecret).not.toHaveBeenCalled();
  });

  it('prefers the active workspace key for Tower PG message deletes', async () => {
    const { createNip98AuthHeader, createNip98AuthHeaderForSecret } = await import('../src/auth/nostr.js');
    const { getActiveWorkspaceKeySecretForAuth } = await import('../src/crypto/workspace-keys.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');
    getActiveWorkspaceKeySecretForAuth.mockReturnValueOnce(new Uint8Array([1, 2, 3]));

    await api.deleteTowerPgMessage('workspace-1', 'message-1', {
      appNpub: 'flightdeck_pg',
      rowVersion: 3,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/messages/message-1?row_version=3',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'NIP98-SECRET DELETE https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/messages/message-1?row_version=3',
          'x-flightdeck-pg-app-npub': 'flightdeck_pg',
        }),
      }),
    );
    expect(createNip98AuthHeaderForSecret).toHaveBeenCalledTimes(1);
    expect(createNip98AuthHeader).not.toHaveBeenCalled();
  });

  it('uses the mutation auth timeout for Tower PG deletes when NIP-98 signing does not settle', async () => {
    vi.useFakeTimers();
    const { createNip98AuthHeader } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');
    createNip98AuthHeader.mockImplementationOnce(() => new Promise(() => {}));

    const deletion = api.deleteTowerPgMessage('workspace-1', 'message-1', {
      appNpub: 'flightdeck_pg',
      rowVersion: 3,
    });
    const assertion = expect(deletion).rejects.toMatchObject({
      code: 'auth_timeout',
      message: expect.stringContaining('NIP-98 signing timed out for DELETE'),
    });

    await vi.advanceTimersByTimeAsync(45_000);

    await assertion;
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('allows longer NIP-98 signing for Tower PG channel grant reads', async () => {
    vi.useFakeTimers();
    const { createNip98AuthHeader } = await import('../src/auth/nostr.js');
    const api = await import('../src/api.js');
    api.setBaseUrl('https://tower.example');
    createNip98AuthHeader.mockImplementationOnce(() => new Promise(() => {}));

    const read = api.getTowerPgChannelGrants('workspace-1', 'channel-1', { appNpub: 'flightdeck_pg' });
    const early = vi.fn();
    read.catch(early);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(early).not.toHaveBeenCalled();

    const assertion = expect(read).rejects.toMatchObject({
      code: 'auth_timeout',
      message: expect.stringContaining('NIP-98 signing timed out for GET'),
    });

    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
