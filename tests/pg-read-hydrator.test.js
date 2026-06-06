import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hydrateTowerPgChannels,
  hydrateTowerPgAudioNotes,
  hydrateTowerPgDocumentsAndFiles,
  hydrateTowerPgScopes,
  hydrateTowerPgTasks,
  mapPgChannelToLocal,
  mapPgAudioNoteToLocal,
  mapPgDocToLocal,
  mapPgFileToLocalDocument,
  mapPgMessageToLocal,
  mapPgScopeToLocal,
  mapPgTaskToLocal,
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
    channels: [],
    applyScopes: vi.fn(async (scopes) => {
      seed.scopes = scopes;
    }),
    applyChannels: vi.fn(async (channels) => {
      seed.channels = channels;
    }),
    applyTasks: vi.fn(async (tasks) => {
      seed.tasks = tasks;
    }),
    applyDocuments: vi.fn((documents) => {
      seed.documents = documents;
    }),
    applyAudioNotes: vi.fn(async (audioNotes) => {
      seed.audioNotes = audioNotes;
    }),
    refreshMessages: vi.fn(),
    ...seed,
  };
}

describe('PG read hydrator', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

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

  it('normalizes saved http Tower URLs before PG API requests on hosted https Flight Deck', () => {
    globalThis.window = { location: { origin: 'https://near-tea-crab.rick.runwingman.com' } };

    expect(resolveTowerPgWorkspaceContext(store({
      backendUrl: 'https://sb4.otherstuff.studio',
      currentWorkspace: {
        ...store().currentWorkspace,
        directHttpsUrl: 'http://sb4.otherstuff.studio',
      },
    }))).toMatchObject({
      baseUrl: 'https://sb4.otherstuff.studio',
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
      level: 'l1',
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

  it('maps PG threads into fallback top-level chat rows', () => {
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

  it('maps PG messages into classic chat rows with source-message thread parents', () => {
    const threadById = new Map([
      ['thread-1', { id: 'thread-1', source_message_id: 'message-1' }],
    ]);
    expect(mapPgMessageToLocal({
      id: 'message-2',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      thread_id: 'thread-1',
      body: 'Reply body',
      row_version: 2,
      updated_at: '2026-06-05T02:00:00.000Z',
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1pete',
      threadById,
    })).toMatchObject({
      record_id: 'message-2',
      channel_id: 'channel-1',
      parent_message_id: 'message-1',
      body: 'Reply body',
      sender_npub: 'npub1pete',
      pg_backend: true,
      pg_record_type: 'message',
      pg_thread_id: 'thread-1',
    });
  });

  it('maps PG tasks into classic task rows with scope and PG channel/thread refs', () => {
    expect(mapPgTaskToLocal({
      id: 'task-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      thread_id: 'thread-1',
      title: 'Wire task API',
      description: 'Implement task writes',
      state: 'in_progress',
      priority: 'stone',
      metadata: { tags: 'pg,migration', board_order: 4 },
      row_version: 6,
      updated_at: '2026-06-05T02:00:00.000Z',
    }, { workspaceOwnerNpub: 'npub1owner' })).toMatchObject({
      record_id: 'task-1',
      owner_npub: 'npub1owner',
      title: 'Wire task API',
      state: 'in_progress',
      priority: 'stone',
      board_order: 4,
      tags: 'pg,migration',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
      pg_backend: true,
      pg_record_type: 'task',
    });
  });

  it('maps PG docs and files into classic document rows for docs/files views', () => {
    expect(mapPgDocToLocal({
      id: 'doc-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      metadata: { thread_id: 'thread-1' },
      storage_object_id: 'object-doc',
      title: 'Design note',
      summary: 'Doc summary',
      body: { object_id: 'object-doc', route: '/body' },
      row_version: 3,
    }, { workspaceOwnerNpub: 'npub1owner' })).toMatchObject({
      record_id: 'doc-1',
      owner_npub: 'npub1owner',
      title: 'Design note',
      content: 'Doc summary',
      content_storage_object_id: 'object-doc',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      pg_record_type: 'doc',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
    });

    expect(mapPgFileToLocalDocument({
      id: 'file-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      metadata: { thread_id: 'thread-1' },
      storage_object_id: 'object-file',
      display_name: 'Brief.pdf',
      row_version: 4,
    }, { workspaceOwnerNpub: 'npub1owner' })).toMatchObject({
      record_id: 'file-1',
      owner_npub: 'npub1owner',
      title: 'Brief.pdf',
      content: '[Brief.pdf](storage://object-file)',
      content_storage_object_id: null,
      scope_id: 'scope-1',
      pg_record_type: 'file',
      pg_thread_id: 'thread-1',
      pg_storage_object_id: 'object-file',
    });
  });

  it('maps PG audio notes into classic audio note rows', () => {
    expect(mapPgAudioNoteToLocal({
      id: 'audio-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      thread_id: 'thread-1',
      target_type: 'message',
      target_id: 'message-1',
      storage_object_id: 'object-audio',
      title: 'Voice note',
      mime_type: 'audio/webm',
      transcript_status: 'complete',
      transcript_preview: 'Hello',
      row_version: 2,
    }, { workspaceOwnerNpub: 'npub1owner', senderNpub: 'npub1pete' })).toMatchObject({
      record_id: 'audio-1',
      owner_npub: 'npub1owner',
      target_record_id: 'message-1',
      title: 'Voice note',
      storage_object_id: 'object-audio',
      sender_npub: 'npub1pete',
      transcript_status: 'complete',
      pg_record_type: 'audio_note',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
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

  it('hydrates accessible PG channels with message/thread snapshots', async () => {
    const target = store({
      scopes: [{ record_id: 'scope-1', record_state: 'active' }],
      selectedChannelId: 'channel-1',
    });
    const getTowerPgScopeChannels = vi.fn(async () => ({
      channels: [{ id: 'channel-1', scope_id: 'scope-1', name: 'Flight Deck PG' }],
    }));
    const getTowerPgChannelThreads = vi.fn(async () => ({
      threads: [{ id: 'thread-1', channel_id: 'channel-1', source_message_id: 'message-1', title: 'Thread one' }],
    }));
    const getTowerPgChannelMessages = vi.fn(async () => ({
      messages: [
        { id: 'message-1', channel_id: 'channel-1', thread_id: 'thread-1', body: 'Thread one' },
        { id: 'message-2', channel_id: 'channel-1', thread_id: 'thread-1', body: 'Reply one' },
      ],
    }));
    const replaceChannelsForOwner = vi.fn(async () => 1);
    const replacePgMessagesForChannel = vi.fn(async () => 2);

    const rows = await hydrateTowerPgChannels(target, {
      getTowerPgScopeChannels,
      getTowerPgChannelThreads,
      getTowerPgChannelMessages,
      replaceChannelsForOwner,
      replacePgMessagesForChannel,
    });

    expect(getTowerPgScopeChannels).toHaveBeenCalledWith('workspace-1', 'scope-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(replaceChannelsForOwner).toHaveBeenCalledWith('npub1owner', rows);
    expect(target.applyChannels).toHaveBeenCalledWith(rows);
    expect(getTowerPgChannelMessages).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(replacePgMessagesForChannel.mock.calls[0][0]).toBe('channel-1');
    expect(replacePgMessagesForChannel.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        record_id: 'message-1',
        body: 'Thread one',
        parent_message_id: null,
        pg_record_type: 'message',
      }),
      expect.objectContaining({
        record_id: 'message-2',
        body: 'Reply one',
        parent_message_id: 'message-1',
        pg_record_type: 'message',
      }),
    ]);
    expect(target.refreshMessages).toHaveBeenCalledWith({ scrollToLatest: false });
  });

  it('hydrates PG tasks from channel and scope task endpoints with dedupe', async () => {
    const target = store({
      scopes: [{ record_id: 'scope-1', record_state: 'active' }],
      channels: [{ record_id: 'channel-1', record_state: 'active' }],
    });
    const getTowerPgChannelTasks = vi.fn(async () => ({
      tasks: [{ id: 'task-1', scope_id: 'scope-1', channel_id: 'channel-1', title: 'Channel task' }],
    }));
    const getTowerPgScopeTasks = vi.fn(async () => ({
      tasks: [
        { id: 'task-1', scope_id: 'scope-1', channel_id: 'channel-1', title: 'Channel task updated', row_version: 2 },
        { id: 'task-2', scope_id: 'scope-1', channel_id: 'channel-1', title: 'Scope task' },
      ],
    }));
    const replaceTasksForOwner = vi.fn(async () => 2);

    const tasks = await hydrateTowerPgTasks(target, {
      getTowerPgChannelTasks,
      getTowerPgScopeTasks,
      replaceTasksForOwner,
    });

    expect(getTowerPgChannelTasks).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(getTowerPgScopeTasks).toHaveBeenCalledWith('workspace-1', 'scope-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.record_id === 'task-1')).toMatchObject({
      title: 'Channel task updated',
      version: 2,
    });
    expect(replaceTasksForOwner).toHaveBeenCalledWith('npub1owner', tasks);
    expect(target.applyTasks).toHaveBeenCalledWith(tasks);
  });

  it('hydrates PG docs and files from accessible channels', async () => {
    const target = store({
      channels: [{ record_id: 'channel-1', record_state: 'active' }],
    });
    const getTowerPgChannelDocs = vi.fn(async () => ({
      docs: [{ id: 'doc-1', scope_id: 'scope-1', channel_id: 'channel-1', storage_object_id: 'object-doc', title: 'Doc' }],
    }));
    const getTowerPgChannelFiles = vi.fn(async () => ({
      files: [{ id: 'file-1', scope_id: 'scope-1', channel_id: 'channel-1', storage_object_id: 'object-file', display_name: 'File.pdf' }],
    }));
    const replaceDocumentsForOwner = vi.fn(async () => 2);

    const documents = await hydrateTowerPgDocumentsAndFiles(target, {
      getTowerPgChannelDocs,
      getTowerPgChannelFiles,
      replaceDocumentsForOwner,
    });

    expect(documents).toEqual([
      expect.objectContaining({ record_id: 'doc-1', pg_record_type: 'doc' }),
      expect.objectContaining({ record_id: 'file-1', pg_record_type: 'file' }),
    ]);
    expect(replaceDocumentsForOwner).toHaveBeenCalledWith('npub1owner', documents);
    expect(target.applyDocuments).toHaveBeenCalledWith(documents);
  });

  it('hydrates PG audio notes from accessible channels', async () => {
    const target = store({
      channels: [{ record_id: 'channel-1', record_state: 'active' }],
    });
    const getTowerPgChannelAudioNotes = vi.fn(async () => ({
      audio_notes: [{ id: 'audio-1', channel_id: 'channel-1', storage_object_id: 'object-audio', title: 'Voice note' }],
    }));
    const replaceAudioNotesForOwner = vi.fn(async () => 1);

    const audioNotes = await hydrateTowerPgAudioNotes(target, {
      getTowerPgChannelAudioNotes,
      replaceAudioNotesForOwner,
    });

    expect(audioNotes).toEqual([
      expect.objectContaining({ record_id: 'audio-1', pg_record_type: 'audio_note' }),
    ]);
    expect(replaceAudioNotesForOwner).toHaveBeenCalledWith('npub1owner', audioNotes);
    expect(target.applyAudioNotes).toHaveBeenCalledWith(audioNotes);
  });
});
