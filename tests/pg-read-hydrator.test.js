import { describe, expect, it, vi } from 'vitest';
import {
  hydrateTowerPgChannels,
  hydrateTowerPgScopes,
  mapPgChannelToLocal,
  mapPgScopeToLocal,
  mapPgThreadToLocal,
  resolveTowerPgWorkspaceContext,
} from '../src/pg-read-hydrator.js';

function store(seed = {}) {
  return {
    backendUrl: 'https://tower.example',
    workspaceOwnerNpub: 'npub1owner',
    session: { npub: 'npub1pete' },
    currentWorkspace: {
      workspaceId: 'workspace-1',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      pgBackendMode: true,
      pgDescriptor: {
        links: {
          scopes: '/api/v4/flightdeck-pg/workspaces/workspace-1/scopes',
        },
      },
    },
    scopes: [],
    applyScopes: vi.fn(async (scopes) => {
      seed.scopes = scopes;
    }),
    applyChannels: vi.fn(async (channels) => {
      seed.channels = channels;
    }),
    refreshMessages: vi.fn(),
    ...seed,
  };
}

describe('PG read hydrator', () => {
  it('resolves Tower PG workspace request context from the selected workspace', () => {
    expect(resolveTowerPgWorkspaceContext(store())).toMatchObject({
      workspaceId: 'workspace-1',
      workspaceOwnerNpub: 'npub1owner',
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      links: {
        scopes: '/api/v4/flightdeck-pg/workspaces/workspace-1/scopes',
      },
    });
  });

  it('maps PG scopes into existing local scope rows', () => {
    expect(mapPgScopeToLocal({
      id: 'scope-1',
      workspace_id: 'workspace-1',
      name: 'Wingman Suite',
      description: 'Suite work',
      kind: 'project',
      owner_group_id: 'group-admins',
      row_version: 7,
      created_at: '2026-06-05T01:00:00.000Z',
      updated_at: '2026-06-05T02:00:00.000Z',
    }, { workspaceOwnerNpub: 'npub1owner' })).toMatchObject({
      record_id: 'scope-1',
      owner_npub: 'npub1owner',
      title: 'Wingman Suite',
      description: 'Suite work',
      level: 'l1',
      parent_id: null,
      group_ids: ['group-admins'],
      sync_status: 'synced',
      record_state: 'active',
      version: 7,
      pg_backend: true,
      pg_record_type: 'scope',
    });
  });

  it('maps PG channels into existing local channel rows scoped to L1', () => {
    expect(mapPgChannelToLocal({
      id: 'channel-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      name: 'Flight Deck PG',
      description: 'Migration channel',
      kind: 'chat',
      row_version: 3,
      updated_at: '2026-06-05T02:00:00.000Z',
    }, { workspaceOwnerNpub: 'npub1owner' })).toMatchObject({
      record_id: 'channel-1',
      owner_npub: 'npub1owner',
      title: 'Flight Deck PG',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      participant_npubs: [],
      group_ids: [],
      sync_status: 'synced',
      pg_backend: true,
      pg_record_type: 'channel',
    });
  });

  it('maps PG threads into top-level chat message rows for existing chat UI', () => {
    expect(mapPgThreadToLocal({
      id: 'thread-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      source_message_id: 'message-1',
      title: 'Specific feature',
      latest: 'Latest reply',
      row_version: 5,
      updated_at: '2026-06-05T02:00:00.000Z',
    }, { workspaceOwnerNpub: 'npub1owner', senderNpub: 'npub1pete' })).toMatchObject({
      record_id: 'thread-1',
      channel_id: 'channel-1',
      parent_message_id: null,
      body: 'Specific feature',
      sender_npub: 'npub1pete',
      sync_status: 'synced',
      pg_backend: true,
      pg_record_type: 'thread',
      pg_source_message_id: 'message-1',
    });
  });

  it('hydrates PG scopes through Tower API and overwrites local scope rows', async () => {
    const target = store();
    const getTowerPgWorkspaceScopes = vi.fn(async () => ({
      scopes: [{ id: 'scope-1', name: 'Wingman Suite', row_version: 1 }],
    }));
    const replaceScopesForOwner = vi.fn(async () => 1);

    const rows = await hydrateTowerPgScopes(target, {
      getTowerPgWorkspaceScopes,
      replaceScopesForOwner,
    });

    expect(getTowerPgWorkspaceScopes).toHaveBeenCalledWith('workspace-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      path: '/api/v4/flightdeck-pg/workspaces/workspace-1/scopes',
    });
    expect(replaceScopesForOwner).toHaveBeenCalledWith('npub1owner', rows);
    expect(target.applyScopes).toHaveBeenCalledWith(rows);
    expect(rows[0]).toMatchObject({ record_id: 'scope-1', title: 'Wingman Suite' });
  });

  it('hydrates accessible PG channels and per-channel thread headers', async () => {
    const target = store({
      scopes: [{ record_id: 'scope-1', record_state: 'active' }],
      selectedChannelId: 'channel-1',
    });
    const getTowerPgScopeChannels = vi.fn(async () => ({
      channels: [{ id: 'channel-1', scope_id: 'scope-1', name: 'Flight Deck PG' }],
    }));
    const getTowerPgChannelThreads = vi.fn(async () => ({
      threads: [{ id: 'thread-1', channel_id: 'channel-1', title: 'Thread one' }],
    }));
    const replaceChannelsForOwner = vi.fn(async () => 1);
    const replacePgThreadsForChannel = vi.fn(async () => 1);

    const rows = await hydrateTowerPgChannels(target, {
      getTowerPgScopeChannels,
      getTowerPgChannelThreads,
      replaceChannelsForOwner,
      replacePgThreadsForChannel,
    });

    expect(getTowerPgScopeChannels).toHaveBeenCalledWith('workspace-1', 'scope-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(replaceChannelsForOwner).toHaveBeenCalledWith('npub1owner', rows);
    expect(target.applyChannels).toHaveBeenCalledWith(rows);
    expect(getTowerPgChannelThreads).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(replacePgThreadsForChannel.mock.calls[0][0]).toBe('channel-1');
    expect(replacePgThreadsForChannel.mock.calls[0][1][0]).toMatchObject({
      record_id: 'thread-1',
      body: 'Thread one',
      pg_record_type: 'thread',
    });
    expect(target.refreshMessages).toHaveBeenCalledWith({ scrollToLatest: false });
  });
});
