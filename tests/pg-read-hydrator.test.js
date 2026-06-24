import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hydrateTowerPgChannels,
  hydrateTowerPgChannelMessages,
  hydrateTowerPgChannelResponseActivities,
  hydrateTowerPgEventUpdates,
  hydrateTowerPgAudioNotes,
  hydrateTowerPgDoc,
  hydrateTowerPgDocComments,
  hydrateTowerPgDocumentsAndFiles,
  hydrateTowerPgResponseActivitiesForTarget,
  hydrateTowerPgScopes,
  hydrateTowerPgTask,
  hydrateTowerPgTasks,
  hydrateTowerPgTaskComments,
  mapPgChannelToLocal,
  mapPgAudioNoteToLocal,
  mapPgDocToLocal,
  mapPgDocCommentToLocal,
  mapPgFileToLocalDocument,
  mapPgMessageToLocal,
  mapPgScopeToLocal,
  mapPgTaskToLocal,
  mapPgTaskCommentToLocal,
  mergePgHydratedTasksWithLocal,
  mapPgThreadToLocal,
  resolveTowerPgWorkspaceContext,
} from '../src/pg-read-hydrator.js';
import { recordFamilyHash } from '../src/translators/chat.js';

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

  it('prefers the selected PG workspace owner over the signed-in actor owner', () => {
    expect(resolveTowerPgWorkspaceContext(store({
      workspaceOwnerNpub: 'npub1signedinactor',
      currentWorkspace: {
        ...store().currentWorkspace,
        workspaceOwnerNpub: 'npub1pgworkspace',
      },
    }))).toMatchObject({
      workspaceOwnerNpub: 'npub1pgworkspace',
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
      metadata: { basePrompt: 'Channel context' },
      participant_npubs: ['npub1alice', 'npub1bob', 'npub1alice'],
      group_ids: ['group-1', 'group-1'],
      row_version: 3,
      updated_at: '2026-06-05T02:00:00.000Z',
    }, { workspaceOwnerNpub: 'npub1owner' })).toMatchObject({
      record_id: 'channel-1',
      owner_npub: 'npub1owner',
      title: 'Flight Deck PG',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      metadata: { basePrompt: 'Channel context' },
      participant_npubs: ['npub1alice', 'npub1bob'],
      group_ids: ['group-1'],
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

  it('preserves deleted PG message state during local mapping', () => {
    expect(mapPgMessageToLocal({
      id: 'message-deleted',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      body: 'Deleted message',
      record_state: 'deleted',
      deleted_at: '2026-06-22T01:00:00.000Z',
      row_version: 3,
      updated_at: '2026-06-22T01:00:00.000Z',
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1pete',
      threadById: new Map(),
    })).toMatchObject({
      record_id: 'message-deleted',
      record_state: 'deleted',
      sync_status: 'synced',
      version: 3,
      pg_backend: true,
    });
  });

  it('maps archived PG thread state onto the source message only', () => {
    const threadById = new Map([
      ['thread-1', {
        id: 'thread-1',
        source_message_id: 'message-1',
        record_state: 'archived',
        archived_at: '2026-06-20T05:00:00.000Z',
      }],
    ]);

    expect(mapPgMessageToLocal({
      id: 'message-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      thread_id: 'thread-1',
      body: 'Thread one',
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1pete',
      threadById,
    })).toMatchObject({
      record_id: 'message-1',
      parent_message_id: null,
      record_state: 'archived',
      pg_archived_at: '2026-06-20T05:00:00.000Z',
    });

    expect(mapPgMessageToLocal({
      id: 'message-2',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      thread_id: 'thread-1',
      body: 'Reply one',
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1pete',
      threadById,
    })).toMatchObject({
      record_id: 'message-2',
      parent_message_id: 'message-1',
      record_state: 'active',
      pg_archived_at: null,
    });
  });

  it('maps PG messages using metadata sender override', () => {
    expect(mapPgMessageToLocal({
      id: 'message-3',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      body: 'Reply body',
      updated_at: '2026-06-05T02:00:00.000Z',
      metadata: {
        sender_npub: 'npub1dave',
        client_record_id: 'local-message-3',
      },
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1pete',
      threadById: new Map(),
    })).toMatchObject({
      record_id: 'message-3',
      sender_npub: 'npub1dave',
      pg_client_record_id: 'local-message-3',
      pg_metadata: {
        sender_npub: 'npub1dave',
        client_record_id: 'local-message-3',
      },
      pg_record_type: 'message',
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
      metadata: {
        tags: 'pg,migration',
        board_order: 4,
        parent_task_id: 'task-parent',
        scheduled_for: '2026-06-22',
        assigned_to_npub: 'npub1stale',
        predecessor_task_ids: ['task-prev'],
        flow_id: 'flow-1',
        source_links: [{ type: 'message', id: 'msg-1' }],
      },
      assignments: [{ actor_id: 'actor-agent', actor_npub: 'npub1agent' }],
      row_version: 6,
      updated_at: '2026-06-05T02:00:00.000Z',
    }, {
      workspaceOwnerNpub: 'npub1owner',
    })).toMatchObject({
      record_id: 'task-1',
      owner_npub: 'npub1owner',
      title: 'Wire task API',
      state: 'in_progress',
      priority: 'stone',
      board_order: 4,
      parent_task_id: 'task-parent',
      tags: 'pg,migration',
      scheduled_for: '2026-06-22',
      assigned_to_npubs: ['npub1agent'],
      assigned_to_npub: 'npub1agent',
      predecessor_task_ids: ['task-prev'],
      flow_id: 'flow-1',
      source_links: [{ type: 'message', id: 'msg-1' }],
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
      pg_backend: true,
      pg_record_type: 'task',
      pg_metadata: expect.objectContaining({ scheduled_for: '2026-06-22' }),
    });
  });

  it('maps PG task assignments from Tower assignment actor npubs without metadata fallback', () => {
    expect(mapPgTaskToLocal({
      id: 'task-assigned',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      title: 'Assigned from Tower',
      metadata: {
        assigned_to_npub: 'npub1stale',
      },
      assignments: [{
        actor_id: 'actor-agent',
        actor_npub: 'npub1agent',
      }],
      row_version: 2,
      updated_at: '2026-06-05T02:00:00.000Z',
    }, {
      workspaceOwnerNpub: 'npub1owner',
    })).toMatchObject({
      record_id: 'task-assigned',
      assigned_to_npubs: ['npub1agent'],
      assigned_to_npub: 'npub1agent',
    });
  });

  it('leaves PG task unassigned when Tower assignment rows omit actor npubs', () => {
    expect(mapPgTaskToLocal({
      id: 'task-missing-assignee-npub',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      title: 'Missing assignment identity',
      metadata: {
        assigned_to_npub: 'npub1stale',
      },
      assignments: [{
        actor_id: 'actor-agent',
      }],
      row_version: 2,
      updated_at: '2026-06-05T02:00:00.000Z',
    }, {
      workspaceOwnerNpub: 'npub1owner',
    })).toMatchObject({
      record_id: 'task-missing-assignee-npub',
      assigned_to_npubs: [],
      assigned_to_npub: null,
    });
  });

  it('maps PG task comments into classic comment rows', () => {
    expect(mapPgTaskCommentToLocal({
      id: 'comment-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      task_id: 'task-1',
      thread_id: 'thread-1',
      body: 'Comment body',
      row_version: 2,
      created_at: '2026-06-06T01:00:00.000Z',
      updated_at: '2026-06-06T01:01:00.000Z',
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1pete',
    })).toMatchObject({
      record_id: 'comment-1',
      owner_npub: 'npub1owner',
      target_record_id: 'task-1',
      target_record_family_hash: expect.stringContaining(':task'),
      parent_comment_id: null,
      body: 'Comment body',
      sender_npub: 'npub1pete',
      sync_status: 'synced',
      version: 2,
      pg_backend: true,
      pg_record_type: 'task_comment',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
    });
  });

  it('maps PG task comments using actor-to-npub resolution', () => {
    expect(mapPgTaskCommentToLocal({
      id: 'comment-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      task_id: 'task-1',
      thread_id: 'thread-1',
      body: 'Comment body',
      created_by_actor_id: 'actor-1',
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1viewer',
      actorNpubByActorId: new Map([['actor-1', 'npub1alice']]),
    })).toMatchObject({
      record_id: 'comment-1',
      sender_npub: 'npub1alice',
      pg_record_type: 'task_comment',
    });
  });

  it('maps PG doc comments into anchored classic comment rows', () => {
    expect(mapPgDocCommentToLocal({
      id: 'doc-comment-1',
      workspace_id: 'workspace-1',
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      doc_id: 'doc-1',
      parent_comment_id: 'root-1',
      body: 'Doc comment',
        metadata: {
          anchor_block_id: 'block-1',
          anchor_line_number: 7,
          comment_status: 'open',
          client_record_id: 'local-comment-1',
        },
      created_by_actor_id: 'actor-1',
      row_version: 2,
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1viewer',
      actorNpubByActorId: new Map([['actor-1', 'npub1alice']]),
    })).toMatchObject({
      record_id: 'doc-comment-1',
      owner_npub: 'npub1owner',
      target_record_id: 'doc-1',
      target_record_family_hash: expect.stringContaining(':document'),
      parent_comment_id: 'root-1',
      anchor_block_id: 'block-1',
      anchor_line_number: 7,
      comment_status: 'open',
      sender_npub: 'npub1alice',
      sync_status: 'synced',
      version: 2,
      pg_backend: true,
      pg_record_type: 'doc_comment',
      pg_channel_id: 'channel-1',
      pg_client_record_id: 'local-comment-1',
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

  it('maps PG audio notes using actor-to-npub resolution', () => {
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
      created_by_actor_id: 'actor-1',
    }, {
      workspaceOwnerNpub: 'npub1owner',
      senderNpub: 'npub1viewer',
      actorNpubByActorId: new Map([['actor-1', 'npub1alice']]),
    })).toMatchObject({
      record_id: 'audio-1',
      sender_npub: 'npub1alice',
      pg_record_type: 'audio_note',
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
      threads: [{
        id: 'thread-1',
        channel_id: 'channel-1',
        source_message_id: 'message-1',
        title: 'Thread one',
        record_state: 'archived',
        archived_at: '2026-06-20T05:00:00.000Z',
      }],
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
        record_state: 'archived',
        pg_archived_at: '2026-06-20T05:00:00.000Z',
        pg_record_type: 'message',
      }),
      expect.objectContaining({
        record_id: 'message-2',
        body: 'Reply one',
        parent_message_id: 'message-1',
        record_state: 'active',
        pg_record_type: 'message',
      }),
    ]);
    expect(target.refreshMessages).toHaveBeenCalledWith({ scrollToLatest: false });
  });

  it('hydrates accessible PG channels with actor-based message sender attribution', async () => {
    const target = store({
      scopes: [{ record_id: 'scope-1', record_state: 'active' }],
      selectedChannelId: 'channel-1',
      pgWorkspaceMembers: [
        { actor_id: 'actor-1', npub: 'npub1alice' },
        { actor_id: 'actor-2', npub: 'npub1bob' },
      ],
    });
    const getTowerPgScopeChannels = vi.fn(async () => ({
      channels: [{ id: 'channel-1', scope_id: 'scope-1', name: 'Flight Deck PG' }],
    }));
    const getTowerPgChannelThreads = vi.fn(async () => ({
      threads: [{ id: 'thread-1', channel_id: 'channel-1', source_message_id: '', title: 'Thread one', created_by_actor_id: 'actor-2' }],
    }));
    const getTowerPgChannelMessages = vi.fn(async () => ({
      messages: [{ id: 'message-1', channel_id: 'channel-1', thread_id: 'thread-1', body: 'Thread one', created_by_actor_id: 'actor-1' }],
    }));
    const replaceChannelsForOwner = vi.fn(async () => 1);
    const replacePgMessagesForChannel = vi.fn(async () => 2);
    const getTowerPgResponseActivities = vi.fn(async () => ({ response_activities: [] }));
    const replacePgResponseActivitiesForChannel = vi.fn(async () => 0);

    await hydrateTowerPgChannels(target, {
      getTowerPgScopeChannels,
      getTowerPgChannelThreads,
      getTowerPgChannelMessages,
      getTowerPgResponseActivities,
      replaceChannelsForOwner,
      replacePgMessagesForChannel,
      replacePgResponseActivitiesForChannel,
    });

    const mapped = replacePgMessagesForChannel.mock.calls[0][1];
    expect(mapped).toEqual([
      expect.objectContaining({ record_id: 'message-1', sender_npub: 'npub1alice' }),
      expect.objectContaining({ record_id: 'thread-1', sender_npub: 'npub1bob' }),
    ]);
  });

  it('hydrates only the requested PG channel messages', async () => {
    const target = store({
      selectedChannelId: 'channel-1',
      pgWorkspaceMembers: [{ actor_id: 'actor-1', npub: 'npub1alice' }],
    });
    const getTowerPgChannelThreads = vi.fn(async () => ({
      threads: [{ id: 'thread-1', channel_id: 'channel-1', source_message_id: '', title: 'Thread one', created_by_actor_id: 'actor-1' }],
    }));
    const getTowerPgChannelMessages = vi.fn(async () => ({
      messages: [{ id: 'message-1', channel_id: 'channel-1', thread_id: 'thread-1', body: 'Thread one', created_by_actor_id: 'actor-1' }],
    }));
    const replacePgMessagesForChannel = vi.fn(async () => 2);
    const getTowerPgResponseActivities = vi.fn(async () => ({ response_activities: [] }));
    const replacePgResponseActivitiesForChannel = vi.fn(async () => 0);

    const rows = await hydrateTowerPgChannelMessages(target, 'channel-1', {
      getTowerPgChannelThreads,
      getTowerPgChannelMessages,
      getTowerPgResponseActivities,
      replacePgMessagesForChannel,
      replacePgResponseActivitiesForChannel,
    });

    expect(getTowerPgChannelThreads).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      includeArchived: true,
    });
    expect(getTowerPgChannelMessages).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(replacePgMessagesForChannel).toHaveBeenCalledWith('channel-1', rows);
    expect(target.refreshMessages).toHaveBeenCalledWith({ scrollToLatest: false });
  });

  it('hydrates deleted PG messages as tombstones so they do not reappear', async () => {
    const target = store({
      selectedChannelId: 'channel-1',
    });
    const getTowerPgChannelThreads = vi.fn(async () => ({
      threads: [],
    }));
    const getTowerPgChannelMessages = vi.fn(async () => ({
      messages: [{
        id: 'message-deleted',
        channel_id: 'channel-1',
        body: 'Deleted message',
        record_state: 'deleted',
        deleted_at: '2026-06-22T01:00:00.000Z',
        row_version: 4,
      }],
    }));
    const replacePgMessagesForChannel = vi.fn(async () => 1);
    const getTowerPgResponseActivities = vi.fn(async () => ({ response_activities: [] }));
    const replacePgResponseActivitiesForChannel = vi.fn(async () => 0);

    const rows = await hydrateTowerPgChannelMessages(target, 'channel-1', {
      getTowerPgChannelThreads,
      getTowerPgChannelMessages,
      getTowerPgResponseActivities,
      replacePgMessagesForChannel,
      replacePgResponseActivitiesForChannel,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        record_id: 'message-deleted',
        record_state: 'deleted',
        version: 4,
      }),
    ]);
    expect(replacePgMessagesForChannel).toHaveBeenCalledWith('channel-1', rows);
  });

  it('does not recreate a missing source message from a PG thread fallback row', async () => {
    const target = store({
      selectedChannelId: 'channel-1',
    });
    const getTowerPgChannelThreads = vi.fn(async () => ({
      threads: [{
        id: 'thread-1',
        channel_id: 'channel-1',
        source_message_id: 'message-deleted',
        title: 'Deleted message',
        record_state: 'active',
      }],
    }));
    const getTowerPgChannelMessages = vi.fn(async () => ({
      messages: [],
    }));
    const replacePgMessagesForChannel = vi.fn(async () => 0);
    const getTowerPgResponseActivities = vi.fn(async () => ({ response_activities: [] }));
    const replacePgResponseActivitiesForChannel = vi.fn(async () => 0);

    const rows = await hydrateTowerPgChannelMessages(target, 'channel-1', {
      getTowerPgChannelThreads,
      getTowerPgChannelMessages,
      getTowerPgResponseActivities,
      replacePgMessagesForChannel,
      replacePgResponseActivitiesForChannel,
    });

    expect(rows).toEqual([]);
    expect(replacePgMessagesForChannel).toHaveBeenCalledWith('channel-1', []);
  });

  it('hydrates changed PG channels from event payloads in parallel', async () => {
    const target = store({ selectedChannelId: 'channel-1' });
    const getTowerPgChannelThreads = vi.fn(async (_workspaceId, channelId) => ({
      threads: [{ id: `thread-${channelId}`, channel_id: channelId, source_message_id: '', title: 'Thread' }],
    }));
    const getTowerPgChannelMessages = vi.fn(async (_workspaceId, channelId) => ({
      messages: [{ id: `message-${channelId}`, channel_id: channelId, thread_id: `thread-${channelId}`, body: 'Body' }],
    }));
    const getTowerPgChannelTasks = vi.fn(async (_workspaceId, channelId) => ({
      tasks: [{ id: `task-${channelId}`, channel_id: channelId, title: 'Task' }],
    }));
    const replacePgMessagesForChannel = vi.fn(async () => 1);
    const replacePgTasksForChannel = vi.fn(async () => 1);
    const getTowerPgResponseActivities = vi.fn(async () => ({ response_activities: [] }));
    const replacePgResponseActivitiesForChannel = vi.fn(async () => 0);

    const result = await hydrateTowerPgEventUpdates(target, [
      { entity_type: 'message', channel_id: 'channel-1' },
      { entity_type: 'thread', channel_id: 'channel-1' },
      { entity_type: 'message', channel_id: 'channel-2' },
      { entity_type: 'task', channel_id: 'channel-3' },
    ], {
      getTowerPgChannelThreads,
      getTowerPgChannelMessages,
      getTowerPgChannelTasks,
      getTowerPgResponseActivities,
      replacePgMessagesForChannel,
      replacePgTasksForChannel,
      replacePgResponseActivitiesForChannel,
    });

    expect(result).toEqual({ channels: 2, appliedTargets: 3, fallbackEvents: 0, events: 4 });
    expect(replacePgMessagesForChannel.mock.calls.map(([channelId]) => channelId).sort()).toEqual(['channel-1', 'channel-2']);
    expect(replacePgTasksForChannel).toHaveBeenCalledWith('channel-3', [expect.objectContaining({ record_id: 'task-channel-3' })]);
  });

  it('hydrates changed PG task events by exact task id when present', async () => {
    const target = store({ tasks: [] });
    const getTowerPgTask = vi.fn(async () => ({
      task: {
        id: 'task-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        thread_id: 'thread-1',
        title: 'Exact task',
        row_version: 3,
      },
    }));
    const upsertTask = vi.fn(async () => 'task-1');
    const getTowerPgChannelTasks = vi.fn();

    const result = await hydrateTowerPgEventUpdates(target, [
      { entity_type: 'task', channel_id: 'channel-1', entity_id: 'task-1', payload: { task_id: 'task-1' } },
    ], {
      getTowerPgTask,
      getTowerPgChannelTasks,
      upsertTask,
    });

    expect(result).toEqual({ channels: 0, appliedTargets: 1, fallbackEvents: 0, events: 1 });
    expect(getTowerPgTask).toHaveBeenCalledWith('workspace-1', 'task-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(getTowerPgChannelTasks).not.toHaveBeenCalled();
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'task-1',
      title: 'Exact task',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
      version: 3,
    }));
    expect(target.applyTasks).toHaveBeenCalledWith([
      expect.objectContaining({ record_id: 'task-1' }),
    ]);
  });

  it('hydrates PG task id events even when Tower omits channel context', async () => {
    const target = store({ tasks: [] });
    const getTowerPgTask = vi.fn(async () => ({
      task: {
        id: 'task-from-chat',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Chat-created task',
        row_version: 1,
      },
    }));
    const upsertTask = vi.fn(async () => 'task-from-chat');
    const getTowerPgChannelTasks = vi.fn();

    const result = await hydrateTowerPgEventUpdates(target, [
      { entity_type: 'task', entity_id: 'task-from-chat', payload: {} },
    ], {
      getTowerPgTask,
      getTowerPgChannelTasks,
      upsertTask,
    });

    expect(result).toEqual({ channels: 0, appliedTargets: 1, fallbackEvents: 0, events: 1 });
    expect(getTowerPgTask).toHaveBeenCalledWith('workspace-1', 'task-from-chat', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(getTowerPgChannelTasks).not.toHaveBeenCalled();
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'task-from-chat',
      title: 'Chat-created task',
    }));
  });

  it('routes PG events to targeted surface hydrators without heartbeat', async () => {
    const target = store({
      selectedChannelId: 'channel-1',
      tasks: [],
      documents: [],
      audioNotes: [],
      dailyNotes: [],
      reactionRows: [],
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      applyReactions: vi.fn(),
      applyDocComments: vi.fn(),
    });
    const getTowerPgChannelDocs = vi.fn(async (_workspaceId, channelId) => ({
      docs: [{ id: `doc-${channelId}`, channel_id: channelId, title: 'Doc' }],
    }));
    const getTowerPgChannelFiles = vi.fn(async (_workspaceId, channelId) => ({
      files: [{ id: `file-${channelId}`, channel_id: channelId, display_name: 'File' }],
    }));
    const getTowerPgChannelAudioNotes = vi.fn(async (_workspaceId, channelId) => ({
      audio_notes: [{ id: `audio-${channelId}`, channel_id: channelId, storage_object_id: 'object-audio', title: 'Voice note' }],
    }));
    const getTowerPgTaskComments = vi.fn(async (_workspaceId, taskId) => ({
      comments: [{ id: `comment-${taskId}`, task_id: taskId, body: 'Comment' }],
    }));
    const getTowerPgDocComments = vi.fn(async (_workspaceId, docId) => ({
      comments: [{ id: `doc-comment-${docId}`, doc_id: docId, body: 'Doc comment' }],
    }));
    const getTowerPgDailyNotes = vi.fn(async (_workspaceId, options) => ({
      daily_notes: [{ id: `daily-${options.ownerActorId}`, owner_actor_id: options.ownerActorId, owner_actor_npub: 'npub1owner', note_date: options.noteDate, title: 'Daily' }],
    }));
    const getTowerPgReactions = vi.fn(async () => ({
      reactions: [{ id: 'reaction-1', target_type: 'message', target_id: 'message-1', emoji: 'thumbs_up', reactor_npub: 'npub1alice' }],
    }));
    const replacePgDocumentsForChannel = vi.fn(async () => 2);
    const replacePgAudioNotesForChannel = vi.fn(async () => 1);
    const replacePgCommentsForTarget = vi.fn(async () => 1);
    const getCommentsByTarget = vi.fn(async (targetId) => [{ record_id: `local-comment-${targetId}`, target_record_id: targetId }]);
    const replacePgDailyNotesForOwnerAndDate = vi.fn(async () => 1);
    const replacePgReactionsForTarget = vi.fn(async () => 1);

    const result = await hydrateTowerPgEventUpdates(target, [
      { entity_type: 'doc', channel_id: 'channel-doc' },
      { entity_type: 'file', channel_id: 'channel-doc' },
      { entity_type: 'audio_note', channel_id: 'channel-audio' },
      { entity_type: 'task_comment', payload: { task_id: 'task-1' } },
      { entity_type: 'doc_comment', payload: { doc_id: 'doc-1' } },
      { entity_type: 'daily_note', payload: { owner_actor_id: 'owner-actor-1', note_date: '2026-06-13' } },
      { entity_type: 'reaction', payload: { target_type: 'message', target_id: 'message-1' } },
      { entity_type: 'scope' },
    ], {
      getTowerPgChannelDocs,
      getTowerPgChannelFiles,
      getTowerPgChannelAudioNotes,
      getTowerPgTaskComments,
      getTowerPgDocComments,
      getTowerPgDailyNotes,
      getTowerPgReactions,
      replacePgDocumentsForChannel,
      replacePgAudioNotesForChannel,
      replacePgCommentsForTarget,
      getCommentsByTarget,
      replacePgDailyNotesForOwnerAndDate,
      replacePgReactionsForTarget,
    });

    expect(result).toEqual({ channels: 0, appliedTargets: 6, fallbackEvents: 1, events: 8 });
    expect(replacePgDocumentsForChannel).toHaveBeenCalledWith('channel-doc', [
      expect.objectContaining({ record_id: 'doc-channel-doc' }),
      expect.objectContaining({ record_id: 'file-channel-doc' }),
    ]);
    expect(replacePgAudioNotesForChannel).toHaveBeenCalledWith('channel-audio', [expect.objectContaining({ record_id: 'audio-channel-audio' })]);
    expect(replacePgCommentsForTarget).toHaveBeenCalledWith('task-1', [expect.objectContaining({ record_id: 'comment-task-1' })]);
    expect(replacePgCommentsForTarget).toHaveBeenCalledWith('doc-1', [expect.objectContaining({ record_id: 'doc-comment-doc-1' })]);
    expect(target.applyDocComments).toHaveBeenCalledWith([expect.objectContaining({ record_id: 'doc-comment-doc-1' })]);
    expect(replacePgDailyNotesForOwnerAndDate).toHaveBeenCalledWith('owner-actor-1', '2026-06-13', [expect.objectContaining({ record_id: 'daily-owner-actor-1' })]);
    expect(replacePgReactionsForTarget).toHaveBeenCalledWith(expect.any(String), 'message-1', [expect.objectContaining({ record_id: 'reaction-1' })]);
  });

  it('treats missing PG reaction targets from SSE hydration as empty reactions', async () => {
    const target = store({
      reactionRows: [
        {
          record_id: 'old-reaction',
          target_record_id: 'message-missing',
          target_record_family_hash: recordFamilyHash('chat_message'),
          emoji: 'thumbs_up',
          record_state: 'active',
          pg_backend: true,
        },
      ],
      applyReactions: vi.fn(),
    });
    const missingTarget = new Error('Tower PG API 404: {"error":"reaction_target_not_found"}');
    missingTarget.status = 404;
    missingTarget.responseText = '{"error":"reaction_target_not_found"}';
    const getTowerPgReactions = vi.fn(async () => {
      throw missingTarget;
    });
    const replacePgReactionsForTarget = vi.fn(async () => 0);

    const result = await hydrateTowerPgEventUpdates(target, [
      { entity_type: 'reaction', payload: { target_type: 'message', target_id: 'message-missing' } },
    ], {
      getTowerPgReactions,
      replacePgReactionsForTarget,
    });

    expect(result).toEqual({ channels: 0, appliedTargets: 1, fallbackEvents: 0, events: 1 });
    expect(replacePgReactionsForTarget).toHaveBeenCalledWith(expect.any(String), 'message-missing', []);
    expect(target.applyReactions).toHaveBeenCalledWith([]);
  });

  it('hydrates Daily Scope events by owner/date without removing another owner same date', async () => {
    const target = store({
      dailyNotes: [
        {
          record_id: 'daily-owner-old',
          pg_backend: true,
          owner_actor_id: 'owner-actor-1',
          note_date: '2026-06-17',
          title: 'Old owner note',
        },
        {
          record_id: 'daily-other-owner',
          pg_backend: true,
          owner_actor_id: 'owner-actor-2',
          note_date: '2026-06-17',
          title: 'Other owner note',
        },
      ],
      applyDailyNotes: vi.fn(async (dailyNotes) => {
        target.dailyNotes = dailyNotes;
      }),
    });
    const getTowerPgDailyNotes = vi.fn(async (_workspaceId, options) => ({
      daily_notes: [{
        id: 'daily-owner-new',
        owner_actor_id: options.ownerActorId,
        owner_actor_npub: 'npub1owner',
        note_date: options.noteDate,
        title: 'Updated owner note',
      }],
    }));
    const replacePgDailyNotesForOwnerAndDate = vi.fn(async () => 1);

    await hydrateTowerPgEventUpdates(target, [
      { entity_type: 'daily_note', payload: { owner_actor_id: 'owner-actor-1', note_date: '2026-06-17' } },
    ], {
      getTowerPgDailyNotes,
      replacePgDailyNotesForOwnerAndDate,
    });

    expect(getTowerPgDailyNotes).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      ownerActorId: 'owner-actor-1',
      noteDate: '2026-06-17',
    }));
    expect(target.dailyNotes.map((note) => note.record_id).sort()).toEqual(['daily-other-owner', 'daily-owner-new']);
  });

  it('hydrates PG channels using workspace member sync when local actor mapping is missing', async () => {
    const getTowerPgWorkspaceMembers = vi.fn(async () => ({
      members: [{ actor: { actor_id: 'actor-1', npub: 'npub1alice' } }],
    }));
    const getTowerPgScopeChannels = vi.fn(async () => ({
      channels: [{ id: 'channel-1', scope_id: 'scope-1', name: 'Flight Deck PG' }],
    }));
    const getTowerPgChannelThreads = vi.fn(async () => ({
      threads: [],
    }));
    const getTowerPgChannelMessages = vi.fn(async () => ({
      messages: [{ id: 'message-1', channel_id: 'channel-1', thread_id: null, body: 'Thread one', created_by_actor_id: 'actor-1' }],
    }));
    const replaceChannelsForOwner = vi.fn(async () => 1);
    const replacePgMessagesForChannel = vi.fn(async () => 1);

    const rows = await hydrateTowerPgChannels(store({
      scopes: [{ record_id: 'scope-1', record_state: 'active' }],
      selectedChannelId: 'channel-1',
    }), {
      getTowerPgWorkspaceMembers,
      getTowerPgScopeChannels,
      getTowerPgChannelThreads,
      getTowerPgChannelMessages,
      replaceChannelsForOwner,
      replacePgMessagesForChannel,
    });

    expect(getTowerPgWorkspaceMembers).toHaveBeenCalledWith('workspace-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(rows).toHaveLength(1);
    expect(replacePgMessagesForChannel.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        record_id: 'message-1',
        sender_npub: 'npub1alice',
      }),
    ]);
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

  it('keeps newer local PG task rows when task hydration returns stale rows', async () => {
    const target = store({
      scopes: [{ record_id: 'scope-1', record_state: 'active' }],
      channels: [{ record_id: 'channel-1', record_state: 'active' }],
      tasks: [{
        record_id: 'task-1',
        owner_npub: 'npub1owner',
        title: 'Task',
        state: 'done',
        version: 3,
        sync_status: 'synced',
        record_state: 'active',
        pg_backend: true,
      }],
    });
    const getTowerPgChannelTasks = vi.fn(async () => ({
      tasks: [{
        id: 'task-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Task',
        state: 'in_progress',
        row_version: 2,
      }],
    }));
    const getTowerPgScopeTasks = vi.fn(async () => ({ tasks: [] }));
    const replaceTasksForOwner = vi.fn(async () => 1);

    const tasks = await hydrateTowerPgTasks(target, {
      getTowerPgChannelTasks,
      getTowerPgScopeTasks,
      replaceTasksForOwner,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ record_id: 'task-1', state: 'done', version: 3 });
    expect(replaceTasksForOwner).toHaveBeenCalledWith('npub1owner', tasks);
    expect(target.applyTasks).toHaveBeenCalledWith(tasks);
  });

  it('prefers hydrated PG task rows when they are as new as local rows', () => {
    const result = mergePgHydratedTasksWithLocal(
      [{ record_id: 'task-1', state: 'done', version: 3, pg_backend: true }],
      [{ record_id: 'task-1', state: 'in_progress', version: 3, pg_backend: true }],
    );

    expect(result).toEqual([{ record_id: 'task-1', state: 'done', version: 3, pg_backend: true }]);
  });

  it('keeps pending local PG task rows over same-version hydrated rows', () => {
    const result = mergePgHydratedTasksWithLocal(
      [{ record_id: 'task-1', state: 'in_progress', version: 3, pg_backend: true, sync_status: 'synced' }],
      [{ record_id: 'task-1', state: 'archive', version: 3, pg_backend: true, sync_status: 'failed' }],
    );

    expect(result).toEqual([{ record_id: 'task-1', state: 'archive', version: 3, pg_backend: true, sync_status: 'failed' }]);
  });

  it('keeps local-only pending PG task rows during hydration', () => {
    const result = mergePgHydratedTasksWithLocal(
      [{ record_id: 'task-1', state: 'done', version: 2, pg_backend: true, sync_status: 'synced' }],
      [{ record_id: 'task-local', state: 'archive', version: 1, pg_backend: true, sync_status: 'failed' }],
    );

    expect(result).toEqual([
      { record_id: 'task-1', state: 'done', version: 2, pg_backend: true, sync_status: 'synced' },
      { record_id: 'task-local', state: 'archive', version: 1, pg_backend: true, sync_status: 'failed' },
    ]);
  });

  it('hydrates one PG task by id without replacing the whole local task set', async () => {
    const target = store({
      tasks: [{ record_id: 'existing-task', title: 'Existing task', record_state: 'active' }],
    });
    const getTowerPgTask = vi.fn(async () => ({
      task: {
        id: 'task-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Fetched task',
      },
    }));
    const upsertTask = vi.fn(async () => 'task-1');

    const task = await hydrateTowerPgTask(target, 'task-1', {
      getTowerPgTask,
      upsertTask,
    });

    expect(task).toMatchObject({
      record_id: 'task-1',
      title: 'Fetched task',
      scope_id: 'scope-1',
      pg_channel_id: 'channel-1',
    });
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({ record_id: 'task-1' }));
    expect(target.applyTasks).toHaveBeenCalledWith([
      expect.objectContaining({ record_id: 'existing-task' }),
      expect.objectContaining({ record_id: 'task-1' }),
    ]);
  });

  it('hydrates PG task comments and replaces the local PG set for the task', async () => {
    const applyTaskComments = vi.fn();
    const getTowerPgTaskComments = vi.fn(async () => ({
      comments: [{
        id: 'comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        task_id: 'task-1',
        body: 'Comment body',
        row_version: 1,
      }],
    }));
    const replacePgCommentsForTarget = vi.fn(async () => 1);
    const getCommentsByTarget = vi.fn(async () => [
      { record_id: 'comment-1', target_record_id: 'task-1', pg_backend: true },
    ]);

    const comments = await hydrateTowerPgTaskComments(store({ applyTaskComments }), 'task-1', {
      getTowerPgTaskComments,
      replacePgCommentsForTarget,
      getCommentsByTarget,
    });

    expect(getTowerPgTaskComments).toHaveBeenCalledWith('workspace-1', 'task-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(replacePgCommentsForTarget).toHaveBeenCalledWith('task-1', expect.arrayContaining([
      expect.objectContaining({ record_id: 'comment-1', target_record_id: 'task-1', pg_backend: true }),
    ]));
    expect(getCommentsByTarget).toHaveBeenCalledWith('task-1');
    expect(applyTaskComments).toHaveBeenCalledWith([
      expect.objectContaining({ record_id: 'comment-1', target_record_id: 'task-1' }),
    ]);
  });

  it('does not apply hydrated PG task comments to the visible panel after the active task changes', async () => {
    const applyTaskComments = vi.fn();
    const getTowerPgTaskComments = vi.fn(async () => ({
      comments: [{
        id: 'comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        task_id: 'task-1',
        body: 'Comment body',
        row_version: 1,
      }],
    }));
    const replacePgCommentsForTarget = vi.fn(async () => 1);
    const getCommentsByTarget = vi.fn(async () => []);

    await hydrateTowerPgTaskComments(store({
      activeTaskId: 'task-2',
      applyTaskComments,
    }), 'task-1', {
      getTowerPgTaskComments,
      replacePgCommentsForTarget,
      getCommentsByTarget,
    });

    expect(replacePgCommentsForTarget).toHaveBeenCalledWith('task-1', expect.arrayContaining([
      expect.objectContaining({ record_id: 'comment-1', target_record_id: 'task-1', pg_backend: true }),
    ]));
    expect(applyTaskComments).not.toHaveBeenCalled();
  });

  it('hydrates PG task comments using actor-to-npub resolution', async () => {
    const applyTaskComments = vi.fn();
    const getTowerPgTaskComments = vi.fn(async () => ({
      comments: [{
        id: 'comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        task_id: 'task-1',
        body: 'Comment body',
        created_by_actor_id: 'actor-1',
      }],
    }));
    const replacePgCommentsForTarget = vi.fn(async () => 1);
    const getCommentsByTarget = vi.fn(async () => [
      { record_id: 'comment-1', target_record_id: 'task-1', sender_npub: 'npub1alice' },
    ]);

    const comments = await hydrateTowerPgTaskComments(store({
      applyTaskComments,
      pgWorkspaceMembers: [{ actor_id: 'actor-1', npub: 'npub1alice' }],
    }), 'task-1', {
      getTowerPgTaskComments,
      replacePgCommentsForTarget,
      getCommentsByTarget,
    });

    expect(comments[0]).toMatchObject({
      record_id: 'comment-1',
      sender_npub: 'npub1alice',
    });
    expect(replacePgCommentsForTarget).toHaveBeenCalledWith('task-1', expect.arrayContaining([
      expect.objectContaining({
        record_id: 'comment-1',
        sender_npub: 'npub1alice',
      }),
    ]));
    expect(applyTaskComments).toHaveBeenCalledWith([
      expect.objectContaining({ record_id: 'comment-1', sender_npub: 'npub1alice' }),
    ]);
  });

  it('does not replace local PG task comments after the workspace context changes mid-hydration', async () => {
    const applyTaskComments = vi.fn();
    const getTowerPgTaskComments = vi.fn(async () => ({
      comments: [{
        id: 'comment-1',
        workspace_id: 'workspace-1',
        task_id: 'task-1',
        body: 'Comment body',
      }],
    }));
    const replacePgCommentsForTarget = vi.fn(async () => 1);
    const getCommentsByTarget = vi.fn(async () => []);
    const target = store({ applyTaskComments });
    getTowerPgTaskComments.mockImplementationOnce(async () => {
      target.currentWorkspace = {
        ...target.currentWorkspace,
        workspaceId: 'workspace-2',
        workspaceOwnerNpub: 'npub1other',
        directHttpsUrl: 'https://other.example',
      };
      return {
        comments: [{
          id: 'comment-1',
          workspace_id: 'workspace-1',
          task_id: 'task-1',
          body: 'Comment body',
        }],
      };
    });

    const comments = await hydrateTowerPgTaskComments(target, 'task-1', {
      getTowerPgTaskComments,
      replacePgCommentsForTarget,
      getCommentsByTarget,
    });

    expect(comments).toEqual([
      expect.objectContaining({ record_id: 'comment-1', target_record_id: 'task-1' }),
    ]);
    expect(replacePgCommentsForTarget).not.toHaveBeenCalled();
    expect(getCommentsByTarget).not.toHaveBeenCalled();
    expect(applyTaskComments).not.toHaveBeenCalled();
  });

  it('hydrates PG doc comments and replaces the local PG set for the doc', async () => {
    const applyDocComments = vi.fn();
    const getTowerPgDocComments = vi.fn(async () => ({
      comments: [{
        id: 'doc-comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        body: 'Doc comment',
        metadata: {
          anchor_block_id: 'block-1',
          anchor_line_number: 3,
        },
        row_version: 1,
      }],
    }));
    const replacePgCommentsForTarget = vi.fn(async () => 1);

    const comments = await hydrateTowerPgDocComments(store({
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      applyDocComments,
    }), 'doc-1', {
      getTowerPgDocComments,
      replacePgCommentsForTarget,
    });

    expect(getTowerPgDocComments).toHaveBeenCalledWith('workspace-1', 'doc-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(replacePgCommentsForTarget).toHaveBeenCalledWith('doc-1', expect.arrayContaining([
      expect.objectContaining({
        record_id: 'doc-comment-1',
        target_record_id: 'doc-1',
        anchor_block_id: 'block-1',
        anchor_line_number: 3,
        pg_backend: true,
      }),
    ]));
    expect(applyDocComments).toHaveBeenCalledWith(comments);
  });

  it('hydrates PG doc comments without replacing the open drawer for another doc', async () => {
    const applyDocComments = vi.fn();
    const getTowerPgDocComments = vi.fn(async () => ({
      comments: [{
        id: 'doc-comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        body: 'Doc comment',
        row_version: 1,
      }],
    }));
    const replacePgCommentsForTarget = vi.fn(async () => 1);

    const comments = await hydrateTowerPgDocComments(store({
      selectedDocType: 'document',
      selectedDocId: 'doc-2',
      applyDocComments,
    }), 'doc-1', {
      getTowerPgDocComments,
      replacePgCommentsForTarget,
    });

    expect(comments).toHaveLength(1);
    expect(replacePgCommentsForTarget).toHaveBeenCalledWith('doc-1', expect.any(Array));
    expect(applyDocComments).not.toHaveBeenCalled();
  });

  it('hydrates PG docs and files from accessible channels', async () => {
    const target = store({
      channels: [{ record_id: 'channel-1', record_state: 'active' }],
    });
    const getTowerPgChannelDocs = vi.fn(async () => ({
      docs: [{
        id: 'doc-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        storage_object_id: 'object-doc',
        title: 'Doc',
        summary: 'Old inline summary',
        body: {
          storage_object: {
            content_type: 'application/vnd.wingman.flightdeck.document-content+json',
            size_bytes: 128,
            sha256_hex: 'abc123',
          },
        },
      }],
    }));
    const getTowerPgChannelFiles = vi.fn(async () => ({
      files: [{ id: 'file-1', scope_id: 'scope-1', channel_id: 'channel-1', storage_object_id: 'object-file', display_name: 'File.pdf' }],
    }));
    const replaceDocumentsForOwner = vi.fn(async () => 2);
    const downloadStorageObject = vi.fn(async () => new TextEncoder().encode(JSON.stringify({
      format: 'document_content_v1',
      content_model: {
        content: '# Updated stored body',
        content_format: null,
        content_blocks: [],
      },
    })));

    const documents = await hydrateTowerPgDocumentsAndFiles(target, {
      getTowerPgChannelDocs,
      getTowerPgChannelFiles,
      replaceDocumentsForOwner,
      downloadStorageObject,
    });

    expect(documents).toEqual([
      expect.objectContaining({
        record_id: 'doc-1',
        pg_record_type: 'doc',
        content: '# Updated stored body',
        content_storage_status: 'loaded',
      }),
      expect.objectContaining({ record_id: 'file-1', pg_record_type: 'file' }),
    ]);
    expect(downloadStorageObject).toHaveBeenCalledWith('object-doc');
    expect(replaceDocumentsForOwner).toHaveBeenCalledWith('npub1owner', documents);
    expect(target.applyDocuments).toHaveBeenCalledWith(documents);
  });

  it('hydrates a selected PG doc directly from the typed body route', async () => {
    const target = store({
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      patchDocumentLocal: vi.fn(),
      applySelectedDocument: vi.fn(),
    });
    const getTowerPgDocBody = vi.fn(async () => ({
      doc: {
        id: 'doc-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        storage_object_id: 'object-new',
        title: 'Doc',
        summary: 'Old summary',
        row_version: 15,
        body: {
          object_id: 'object-new',
          storage_object: {
            content_type: 'text/markdown; charset=utf-8',
            size_bytes: 17,
            sha256_hex: 'abc123',
          },
        },
      },
      body: {
        object_id: 'object-new',
        content_type: 'text/markdown; charset=utf-8',
        size_bytes: 17,
        sha256_hex: 'abc123',
        encoding: 'base64',
        base64_data: btoa('# Fresh PG body'),
      },
    }));
    const upsertDocument = vi.fn();

    const row = await hydrateTowerPgDoc(target, 'doc-1', {
      getTowerPgDocBody,
      upsertDocument,
    });

    expect(row).toMatchObject({
      record_id: 'doc-1',
      content: '# Fresh PG body',
      content_storage_object_id: 'object-new',
      content_storage_status: 'loaded',
      version: 15,
    });
    expect(getTowerPgDocBody).toHaveBeenCalledWith('workspace-1', 'doc-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(upsertDocument).toHaveBeenCalledWith(row);
    expect(target.patchDocumentLocal).toHaveBeenCalledWith(row);
    expect(target.applySelectedDocument).toHaveBeenCalledWith(row);
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

  it('hydrates PG audio notes using actor-to-npub resolution', async () => {
    const target = store({
      channels: [{ record_id: 'channel-1', record_state: 'active' }],
      pgWorkspaceMembers: [{ actor_id: 'actor-1', npub: 'npub1alice' }],
    });
    const getTowerPgChannelAudioNotes = vi.fn(async () => ({
      audio_notes: [{ id: 'audio-1', channel_id: 'channel-1', storage_object_id: 'object-audio', title: 'Voice note', created_by_actor_id: 'actor-1' }],
    }));
    const replaceAudioNotesForOwner = vi.fn(async () => 1);

    const audioNotes = await hydrateTowerPgAudioNotes(target, {
      getTowerPgChannelAudioNotes,
      replaceAudioNotesForOwner,
    });

    expect(audioNotes[0]).toMatchObject({
      record_id: 'audio-1',
      sender_npub: 'npub1alice',
    });
    expect(replaceAudioNotesForOwner).toHaveBeenCalledWith('npub1owner', expect.arrayContaining([
      expect.objectContaining({ record_id: 'audio-1', sender_npub: 'npub1alice' }),
    ]));
  });

  it('hydrates active PG response activities for a channel', async () => {
    const target = store();
    const getTowerPgResponseActivities = vi.fn(async () => ({
      response_activities: [{
        id: 'activity-1',
        workspace_id: 'workspace-1',
        channel_id: 'channel-1',
        target_type: 'chat_thread',
        target_id: 'pg-thread-1',
        status: 'thinking',
        label: 'Thinking',
        expires_at: '2999-01-01T00:00:00.000Z',
      }],
    }));
    const replacePgResponseActivitiesForChannel = vi.fn(async () => 1);

    const activities = await hydrateTowerPgChannelResponseActivities(target, 'channel-1', {
      getTowerPgResponseActivities,
      replacePgResponseActivitiesForChannel,
    });

    expect(getTowerPgResponseActivities).toHaveBeenCalledWith('workspace-1', {
      channelId: 'channel-1',
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(activities).toEqual([
      expect.objectContaining({
        record_id: 'activity-1',
        pg_backend: true,
        target_type: 'chat_thread',
        target_id: 'pg-thread-1',
        status: 'thinking',
      }),
    ]);
    expect(replacePgResponseActivitiesForChannel).toHaveBeenCalledWith('channel-1', activities);
  });

  it('hydrates PG response activities for an open thread target', async () => {
    const target = store();
    const getTowerPgResponseActivities = vi.fn(async () => ({
      response_activities: [{
        id: 'activity-1',
        workspace_id: 'workspace-1',
        channel_id: 'channel-1',
        target_type: 'chat_thread',
        target_id: 'pg-thread-1',
        status: 'writing',
        expires_at: '2999-01-01T00:00:00.000Z',
      }],
    }));
    const replacePgResponseActivitiesForTarget = vi.fn(async () => 1);

    const activities = await hydrateTowerPgResponseActivitiesForTarget(target, 'chat_thread', 'pg-thread-1', {
      getTowerPgResponseActivities,
      replacePgResponseActivitiesForTarget,
    });

    expect(getTowerPgResponseActivities).toHaveBeenCalledWith('workspace-1', {
      targetType: 'chat_thread',
      targetId: 'pg-thread-1',
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(replacePgResponseActivitiesForTarget).toHaveBeenCalledWith('chat_thread', 'pg-thread-1', activities);
  });
});
