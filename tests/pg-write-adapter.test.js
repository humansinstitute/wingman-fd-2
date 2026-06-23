import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTowerPgAudioNoteFromLocal,
  createTowerPgDocCommentFromLocal,
  createTowerPgDocFromLocal,
  createTowerPgFileFromLocal,
  createTowerPgMessageFromLocal,
  createTowerPgTaskCommentFromLocal,
  createTowerPgTaskFromLocal,
  archiveTowerPgThreadFromLocal,
  deleteTowerPgDocCommentFromLocal,
  deleteTowerPgMessageFromLocal,
  deleteTowerPgTaskFromLocal,
  deleteTowerPgThreadFromLocal,
  resolveTowerPgTaskChannel,
  updateTowerPgDocCommentFromLocal,
  updateTowerPgDocFromLocal,
  updateTowerPgFileFromLocal,
  updateTowerPgTaskFromLocal,
} from '../src/pg-write-adapter.js';
import { recordFamilyHash } from '../src/translators/chat.js';

vi.mock('../src/api.js', () => ({
  acquireTowerPgEditLease: vi.fn(),
  archiveTowerPgThread: vi.fn(),
  assignTowerPgTask: vi.fn(),
  createTowerPgChannelAudioNote: vi.fn(),
  createTowerPgChannelDoc: vi.fn(),
  createTowerPgChannelFile: vi.fn(),
  createTowerPgChannelMessage: vi.fn(),
  createTowerPgChannelTask: vi.fn(),
  createTowerPgDocComment: vi.fn(),
  createTowerPgTaskComment: vi.fn(),
  deleteTowerPgDocComment: vi.fn(),
  deleteTowerPgTask: vi.fn(),
  deleteTowerPgMessage: vi.fn(),
  deleteTowerPgThread: vi.fn(),
  getTowerPgChannelAudioNotes: vi.fn(),
  getTowerPgChannelDocs: vi.fn(),
  getTowerPgChannelFiles: vi.fn(),
  getTowerPgChannelMessages: vi.fn(),
  getTowerPgChannelTasks: vi.fn(),
  getTowerPgTaskComments: vi.fn(),
  getTowerPgChannelThreads: vi.fn(),
  getTowerPgScopeChannels: vi.fn(),
  getTowerPgScopeTasks: vi.fn(),
  getTowerPgWorkspaceScopes: vi.fn(),
  releaseTowerPgEditLease: vi.fn(),
  renewTowerPgEditLease: vi.fn(),
  updateTowerPgDoc: vi.fn(),
  updateTowerPgDocComment: vi.fn(),
  updateTowerPgFile: vi.fn(),
  updateTowerPgTask: vi.fn(),
  updateTowerPgTaskState: vi.fn(),
  unassignTowerPgTask: vi.fn(),
}));

vi.mock('../src/message-instruction-signatures.js', () => ({
  buildAgentInstructionSignature: vi.fn(() => Promise.resolve({ signed_event_id: 'signature-1' })),
}));

function store(seed = {}) {
  return {
    backendUrl: 'https://tower.example',
    workspaceOwnerNpub: 'npub1owner',
    session: { npub: 'npub1pete' },
    selectedChannelId: 'channel-1',
    channels: [
      { record_id: 'channel-1', scope_id: 'scope-1', scope_l1_id: 'scope-1', record_state: 'active' },
      { record_id: 'channel-2', scope_id: 'scope-2', scope_l1_id: 'scope-2', record_state: 'active' },
    ],
    pgWorkspaceMembers: [
      { actor_id: 'actor-agent', npub: 'npub1agent' },
      { actor_id: 'actor-other', npub: 'npub1other' },
    ],
    getPgWorkspaceMemberActorId(npub) {
      return this.pgWorkspaceMembers.find((member) => member.npub === npub)?.actor_id || '';
    },
    currentWorkspace: {
      workspaceId: 'workspace-1',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      pgBackendMode: true,
    },
    ...seed,
  };
}

describe('PG write adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the selected channel when it matches the task scope', () => {
    expect(resolveTowerPgTaskChannel(store(), { scope_id: 'scope-1' })).toMatchObject({
      record_id: 'channel-1',
    });
  });

  it('does not fall back to a different channel under the requested task scope', () => {
    expect(resolveTowerPgTaskChannel(store({ selectedChannelId: 'channel-1' }), { scope_id: 'scope-2' })).toBeNull();
  });

  it('creates a Tower PG task and maps the accepted response', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelTask.mockResolvedValue({
      task: {
        id: 'task-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Task',
        state: 'new',
        priority: 'sand',
        row_version: 1,
      },
    });

    const task = await createTowerPgTaskFromLocal(store(), {
      title: 'Task',
      description: '',
      state: 'new',
      priority: 'sand',
      scope_id: 'scope-1',
    });

    expect(api.createTowerPgChannelTask).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      title: 'Task',
      description: null,
      state: 'new',
      priority: 'sand',
      thread_id: null,
      metadata: expect.objectContaining({ board_order: null, tags: '' }),
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(task).toMatchObject({ record_id: 'task-1', pg_channel_id: 'channel-1' });
  });

  it('stores classic quick task fields in PG task metadata on create and assigns through Tower relation', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelTask.mockResolvedValue({
      task: {
        id: 'task-quick',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Task',
        state: 'new',
        priority: 'sand',
        metadata: {
          scheduled_for: '2026-06-22',
          tags: 'ops,urgent',
          predecessor_task_ids: ['task-prev'],
        },
        row_version: 1,
      },
    });

    await createTowerPgTaskFromLocal(store(), {
      title: 'Task',
      scope_id: 'scope-1',
      scheduled_for: '2026-06-22',
      assigned_to_npubs: ['npub1agent'],
      tags: 'ops,urgent',
      predecessor_task_ids: ['task-prev'],
    });

    expect(api.createTowerPgChannelTask).toHaveBeenCalledWith('workspace-1', 'channel-1', expect.objectContaining({
      metadata: expect.objectContaining({
        scheduled_for: '2026-06-22',
        tags: 'ops,urgent',
        predecessor_task_ids: ['task-prev'],
      }),
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(api.createTowerPgChannelTask.mock.calls[0][2].metadata).not.toHaveProperty('assigned_to_npub');
    expect(api.assignTowerPgTask).toHaveBeenCalledWith('workspace-1', 'task-quick', 'actor-agent', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
  });

  it('passes PG thread context when creating a Tower PG task', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelTask.mockResolvedValue({
      task: {
        id: 'task-thread',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        thread_id: 'thread-1',
        title: 'Task',
        state: 'new',
        priority: 'sand',
        row_version: 1,
      },
    });

    await createTowerPgTaskFromLocal(store(), {
      title: 'Task',
      scope_id: 'scope-1',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
    });

    expect(api.createTowerPgChannelTask).toHaveBeenCalledWith('workspace-1', 'channel-1', expect.objectContaining({
      thread_id: 'thread-1',
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
  });

  it('rejects PG task creation when an explicit channel mismatches the task scope', async () => {
    await expect(createTowerPgTaskFromLocal(store({ selectedChannelId: 'channel-1' }), {
      title: 'Task',
      scope_id: 'scope-2',
      pg_channel_id: 'channel-1',
    })).rejects.toThrow('Selected PG channel does not belong to the requested scope');
  });

  it('creates Tower PG docs with selected channel and metadata thread context', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelDoc.mockResolvedValue({
      doc: {
        id: 'doc-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        storage_object_id: 'storage-doc',
        title: 'Doc',
        metadata: { thread_id: 'thread-1' },
        row_version: 1,
      },
    });

    const doc = await createTowerPgDocFromLocal(store(), {
      title: 'Doc',
      content_storage_object_id: 'storage-doc',
      scope_id: 'scope-1',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
    });

    expect(api.createTowerPgChannelDoc).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      title: 'Doc',
      storage_object_id: 'storage-doc',
      summary: null,
      metadata: { thread_id: 'thread-1' },
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(doc).toMatchObject({ record_id: 'doc-1', pg_channel_id: 'channel-1', pg_thread_id: 'thread-1' });
  });

  it('creates Tower PG files with selected channel and metadata thread context', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelFile.mockResolvedValue({
      file: {
        id: 'file-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        storage_object_id: 'storage-file',
        display_name: 'File.pdf',
        metadata: { thread_id: 'thread-1' },
        row_version: 1,
      },
    });

    const file = await createTowerPgFileFromLocal(store(), {
      display_name: 'File.pdf',
      storage_object_id: 'storage-file',
      scope_id: 'scope-1',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
    });

    expect(api.createTowerPgChannelFile).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      storage_object_id: 'storage-file',
      display_name: 'File.pdf',
      description: null,
      metadata: { thread_id: 'thread-1' },
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(file).toMatchObject({ record_id: 'file-1', pg_channel_id: 'channel-1', pg_thread_id: 'thread-1' });
  });

  it('rejects PG file creation when the selected channel mismatches the requested scope', async () => {
    await expect(createTowerPgFileFromLocal(store({ selectedChannelId: 'channel-1' }), {
      display_name: 'File.pdf',
      storage_object_id: 'storage-file',
      scope_id: 'scope-2',
      pg_channel_id: 'channel-1',
    })).rejects.toThrow('Selected PG channel does not belong to the requested scope');
  });

  it('updates Tower PG files with a new channel and row version', async () => {
    const api = await import('../src/api.js');
    api.updateTowerPgFile.mockResolvedValue({
      file: {
        id: 'file-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-2',
        channel_id: 'channel-2',
        storage_object_id: 'storage-file',
        display_name: 'File.pdf',
        metadata: {},
        row_version: 6,
      },
    });

    const file = await updateTowerPgFileFromLocal(store(), {
      record_id: 'file-1',
      title: 'File.pdf',
      pg_record_type: 'file',
      pg_storage_object_id: 'storage-file',
      scope_id: 'scope-2',
      pg_channel_id: 'channel-2',
      version: 5,
    }, {
      version: 4,
    });

    expect(api.updateTowerPgFile).toHaveBeenCalledWith('workspace-1', 'file-1', {
      row_version: 4,
      channel_id: 'channel-2',
      display_name: 'File.pdf',
      description: null,
      metadata: {},
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(file).toMatchObject({ record_id: 'file-1', pg_channel_id: 'channel-2', version: 6 });
  });

  it('creates Tower PG audio notes with selected channel and first-class thread context', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelAudioNote.mockResolvedValue({
      audio_note: {
        id: 'audio-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        thread_id: 'thread-1',
        storage_object_id: 'storage-audio',
        title: 'Voice note',
        mime_type: 'audio/webm',
        size_bytes: 3,
        row_version: 1,
      },
    });

    const audio = await createTowerPgAudioNoteFromLocal(store(), {
      title: 'Voice note',
      storage_object_id: 'storage-audio',
      mime_type: 'audio/webm',
      size_bytes: 3,
      scope_id: 'scope-1',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
      target_record_family_hash: recordFamilyHash('chat_message'),
      target_record_id: 'message-1',
    });

    const body = api.createTowerPgChannelAudioNote.mock.calls[0][2];
    expect(api.createTowerPgChannelAudioNote).toHaveBeenCalledWith('workspace-1', 'channel-1', expect.objectContaining({
      storage_object_id: 'storage-audio',
      thread_id: 'thread-1',
      target_type: 'message',
      target_id: 'message-1',
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(body).not.toHaveProperty('transcript_preview');
    expect(body).not.toHaveProperty('summary');
    expect(audio).toMatchObject({ record_id: 'audio-1', pg_channel_id: 'channel-1', pg_thread_id: 'thread-1' });
  });

  it('uses the state endpoint for state-only task patches', async () => {
    const api = await import('../src/api.js');
    api.updateTowerPgTaskState.mockResolvedValue({
      task: {
        id: 'task-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Task',
        state: 'done',
        priority: 'sand',
        row_version: 2,
      },
    });

    const task = await updateTowerPgTaskFromLocal(store({
      pgEditLeaseSessions: {
        'task:task-1': { lease: { lease_token: 'state-lease-token' } },
      },
    }), {
      record_id: 'task-1',
      pg_backend: true,
      sync_status: 'synced',
      title: 'Task',
      state: 'done',
      priority: 'sand',
      version: 2,
    }, { record_id: 'task-1', version: 1, pg_backend: true, sync_status: 'synced' }, { state: 'done' });

    expect(api.updateTowerPgTaskState).toHaveBeenCalledWith('workspace-1', 'task-1', {
      row_version: 1,
      lease_token: 'state-lease-token',
      state: 'done',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(task).toMatchObject({ record_id: 'task-1', state: 'done', version: 2 });
  });

  it('splits PG task state changes from classic metadata quick patches', async () => {
    const api = await import('../src/api.js');
    api.updateTowerPgTaskState.mockResolvedValue({
      task: {
        id: 'task-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Task',
        state: 'archive',
        priority: 'sand',
        row_version: 2,
      },
    });
    api.updateTowerPgTask.mockResolvedValue({
      task: {
        id: 'task-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Task',
        state: 'archive',
        priority: 'sand',
        metadata: { scheduled_for: '2026-06-22', tags: '' },
        row_version: 3,
      },
    });

    const task = await updateTowerPgTaskFromLocal(store({
      pgEditLeaseSessions: {
        'task:task-1': { lease: { lease_token: 'quick-lease-token' } },
      },
    }), {
      record_id: 'task-1',
      pg_backend: true,
      sync_status: 'synced',
      title: 'Task',
      state: 'archive',
      priority: 'sand',
      assigned_to_npubs: [],
      scheduled_for: '2026-06-22',
      version: 2,
    }, { record_id: 'task-1', version: 1, pg_backend: true, sync_status: 'synced', assigned_to_npubs: ['npub1agent'] }, {
      state: 'archive',
      assigned_to_npubs: [],
      scheduled_for: '2026-06-22',
    });

    expect(api.updateTowerPgTaskState).toHaveBeenCalledWith('workspace-1', 'task-1', {
      row_version: 1,
      lease_token: 'quick-lease-token',
      state: 'archive',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(api.updateTowerPgTask).toHaveBeenCalledWith('workspace-1', 'task-1', expect.objectContaining({
      row_version: 2,
      lease_token: 'quick-lease-token',
      metadata: expect.objectContaining({
        scheduled_for: '2026-06-22',
      }),
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(api.updateTowerPgTask.mock.calls[0][2].metadata).not.toHaveProperty('assigned_to_npub');
    expect(api.unassignTowerPgTask).toHaveBeenCalledWith('workspace-1', 'task-1', 'actor-agent', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(task).toMatchObject({ record_id: 'task-1', state: 'archive', version: 3, scheduled_for: '2026-06-22' });
  });

  it('adds PG edit lease token and row version to synced task save payloads', async () => {
    const api = await import('../src/api.js');
    api.updateTowerPgTask.mockResolvedValue({
      task: {
        id: 'task-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Edited',
        state: 'new',
        priority: 'sand',
        row_version: 3,
      },
    });

    await updateTowerPgTaskFromLocal(store({
      pgEditLeaseSessions: {
        'task:task-1': { lease: { lease_token: 'lease-token-1' } },
      },
    }), {
      record_id: 'task-1',
      pg_backend: true,
      sync_status: 'synced',
      title: 'Edited',
      description: 'Body',
      state: 'new',
      priority: 'sand',
      version: 3,
    }, { version: 2, pg_backend: true, sync_status: 'synced' }, { title: 'Edited' });

    expect(api.updateTowerPgTask).toHaveBeenCalledWith('workspace-1', 'task-1', expect.objectContaining({
      row_version: 2,
      lease_token: 'lease-token-1',
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
  });

  it('deletes Tower PG tasks through the typed delete endpoint', async () => {
    const api = await import('../src/api.js');
    api.deleteTowerPgTask.mockResolvedValue({
      task: {
        id: 'task-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        title: 'Deleted',
        state: 'new',
        priority: 'sand',
        row_version: 4,
      },
    });

    const task = await deleteTowerPgTaskFromLocal(store(), {
      record_id: 'task-1',
      pg_backend: true,
      sync_status: 'synced',
      version: 3,
    });

    expect(api.deleteTowerPgTask).toHaveBeenCalledWith('workspace-1', 'task-1', {
      rowVersion: 3,
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(task).toMatchObject({ record_id: 'task-1', version: 4, pg_channel_id: 'channel-1' });
  });

  it('adds PG edit lease token and row version to synced document save payloads', async () => {
    const api = await import('../src/api.js');
    api.updateTowerPgDoc.mockResolvedValue({
      doc: {
        id: 'doc-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        storage_object_id: 'storage-doc',
        title: 'Doc edited',
        row_version: 5,
      },
    });

    await updateTowerPgDocFromLocal(store({
      pgEditLeaseSessions: {
        'document:doc-1': { lease: { lease_token: 'doc-lease-token' } },
      },
    }), {
      record_id: 'doc-1',
      pg_backend: true,
      sync_status: 'synced',
      title: 'Doc edited',
      content: 'Body',
      pg_channel_id: 'channel-1',
      content_storage_object_id: 'storage-doc',
      version: 5,
    }, {
      record_id: 'doc-1',
      pg_backend: true,
      sync_status: 'synced',
      version: 4,
    });

    expect(api.updateTowerPgDoc).toHaveBeenCalledWith('workspace-1', 'doc-1', expect.objectContaining({
      row_version: 4,
      lease_token: 'doc-lease-token',
      channel_id: 'channel-1',
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
  });

  it('creates Tower PG thread messages and maps the returned message', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelMessage.mockResolvedValue({
      message: {
        id: 'message-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        thread_id: 'thread-1',
        body: 'Hello',
        row_version: 1,
      },
      thread: {
        id: 'thread-1',
        source_message_id: 'message-1',
      },
    });

    const message = await createTowerPgMessageFromLocal(store(), {
      record_id: 'local-message-1',
      channel_id: 'channel-1',
      body: 'Hello',
    });

    expect(api.createTowerPgChannelMessage).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      body: 'Hello',
      message_signature: { signed_event_id: 'signature-1' },
      metadata: { client_record_id: 'local-message-1' },
      create_thread: true,
      thread_title: 'Hello',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(message).toMatchObject({ record_id: 'message-1', parent_message_id: null, pg_thread_id: 'thread-1' });
  });

  it('creates Tower PG messages with the local client record id in metadata', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelMessage.mockResolvedValue({
      message: {
        id: 'message-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        thread_id: 'thread-1',
        body: 'Hello',
        row_version: 1,
        metadata: {
          client_record_id: 'local-message-1',
        },
      },
      thread: {
        id: 'thread-1',
        source_message_id: 'message-1',
      },
    });

    const message = await createTowerPgMessageFromLocal(store(), {
      record_id: 'local-message-1',
      channel_id: 'channel-1',
      body: 'Hello',
    });

    expect(api.createTowerPgChannelMessage.mock.calls[0][2]).toMatchObject({
      metadata: { client_record_id: 'local-message-1' },
    });
    expect(message).toMatchObject({
      record_id: 'message-1',
      pg_client_record_id: 'local-message-1',
    });
  });

  it('maps Tower PG replies to the local thread parent when the response omits thread metadata', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgChannelMessage.mockResolvedValue({
      message: {
        id: 'reply-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        thread_id: 'thread-1',
        body: 'Reply',
        row_version: 1,
      },
    });

    const message = await createTowerPgMessageFromLocal(store(), {
      record_id: 'local-reply-1',
      channel_id: 'channel-1',
      body: 'Reply',
    }, {
      parentMessage: {
        record_id: 'root-message-1',
        pg_thread_id: 'thread-1',
      },
    });

    expect(api.createTowerPgChannelMessage).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      body: 'Reply',
      message_signature: { signed_event_id: 'signature-1' },
      metadata: { client_record_id: 'local-reply-1' },
      thread_id: 'thread-1',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(message).toMatchObject({
      record_id: 'reply-1',
      parent_message_id: 'root-message-1',
      pg_thread_id: 'thread-1',
    });
  });

  it('retries message delete against the accepted PG row when a stale client id is missing', async () => {
    const api = await import('../src/api.js');
    const missing = new Error('Flight Deck PG message not found');
    missing.status = 404;
    missing.code = 'message_not_found';
    api.deleteTowerPgMessage
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({
        message: {
          id: 'server-message-1',
          workspace_id: 'workspace-1',
          channel_id: 'channel-1',
          body: 'Delete me',
          record_state: 'deleted',
          row_version: 3,
          metadata: {
            client_record_id: 'local-message-1',
          },
        },
      });

    const message = await deleteTowerPgMessageFromLocal(store({
      messages: [
        {
          record_id: 'server-message-1',
          channel_id: 'channel-1',
          body: 'Delete me',
          version: 2,
          record_state: 'active',
          pg_backend: true,
          pg_client_record_id: 'local-message-1',
        },
      ],
    }), {
      record_id: 'local-message-1',
      channel_id: 'channel-1',
      body: 'Delete me',
      version: 1,
      pg_backend: true,
    });

    expect(api.deleteTowerPgMessage.mock.calls.map((call) => call[1])).toEqual([
      'local-message-1',
      'server-message-1',
    ]);
    expect(message).toMatchObject({
      record_id: 'server-message-1',
      record_state: 'deleted',
      pg_client_record_id: 'local-message-1',
    });
  });

  it('creates Tower PG task comments and maps the accepted comment', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgTaskComment.mockResolvedValue({
      comment: {
        id: 'comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        task_id: 'task-1',
        thread_id: 'thread-1',
        body: 'Task comment',
        row_version: 1,
      },
    });

    const comment = await createTowerPgTaskCommentFromLocal(store(), {
      target_record_id: 'task-1',
      body: 'Task comment',
      pg_thread_id: 'thread-1',
    });

    expect(api.createTowerPgTaskComment).toHaveBeenCalledWith('workspace-1', 'task-1', {
      body: 'Task comment',
      thread_id: 'thread-1',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(comment).toMatchObject({
      record_id: 'comment-1',
      target_record_id: 'task-1',
      body: 'Task comment',
      sync_status: 'synced',
      pg_backend: true,
      pg_record_type: 'task_comment',
    });
  });

  it('creates Tower PG document comments with anchor metadata', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgDocComment.mockResolvedValue({
      comment: {
        id: 'doc-comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        parent_comment_id: null,
        body: 'Doc comment',
        metadata: {
          anchor_block_id: 'block-1',
          anchor_line_number: 12,
          comment_status: 'open',
        },
        row_version: 1,
      },
    });

    const comment = await createTowerPgDocCommentFromLocal(store(), {
      target_record_id: 'doc-1',
      body: 'Doc comment',
      anchor_block_id: 'block-1',
      anchor_line_number: 12,
      comment_status: 'open',
      pg_metadata: {
        client_record_id: 'local-comment-1',
      },
    });

    expect(api.createTowerPgDocComment).toHaveBeenCalledWith('workspace-1', 'doc-1', {
      body: 'Doc comment',
      metadata: {
        anchor_block_id: 'block-1',
        anchor_line_number: 12,
        comment_status: 'open',
        client_record_id: 'local-comment-1',
      },
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(comment).toMatchObject({
      record_id: 'doc-comment-1',
      target_record_id: 'doc-1',
      target_record_family_hash: recordFamilyHash('document'),
      anchor_block_id: 'block-1',
      anchor_line_number: 12,
      pg_record_type: 'doc_comment',
    });
  });

  it('updates Tower PG document comment status', async () => {
    const api = await import('../src/api.js');
    api.updateTowerPgDocComment.mockResolvedValue({
      comment: {
        id: 'doc-comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        parent_comment_id: null,
        body: 'Doc comment',
        metadata: {
          anchor_block_id: 'block-1',
          anchor_line_number: 12,
          comment_status: 'resolved',
        },
        row_version: 2,
      },
    });

    const comment = await updateTowerPgDocCommentFromLocal(store(), {
      record_id: 'doc-comment-1',
      target_record_id: 'doc-1',
      body: 'Doc comment',
      anchor_block_id: 'block-1',
      anchor_line_number: 12,
      comment_status: 'resolved',
      previous_version: 1,
      version: 2,
    });

    expect(api.updateTowerPgDocComment).toHaveBeenCalledWith('workspace-1', 'doc-1', 'doc-comment-1', {
      comment_status: 'resolved',
      row_version: 1,
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(comment).toMatchObject({
      record_id: 'doc-comment-1',
      comment_status: 'resolved',
      version: 2,
      pg_record_type: 'doc_comment',
    });
  });

  it('deletes Tower PG document comments and maps the local row as deleted', async () => {
    const api = await import('../src/api.js');
    api.deleteTowerPgDocComment.mockResolvedValue({
      comment: {
        id: 'doc-comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        parent_comment_id: null,
        body: 'Doc comment',
        metadata: {
          comment_status: 'open',
        },
        row_version: 2,
      },
    });

    const comment = await deleteTowerPgDocCommentFromLocal(store(), {
      record_id: 'doc-comment-1',
      target_record_id: 'doc-1',
      version: 1,
    });

    expect(api.deleteTowerPgDocComment).toHaveBeenCalledWith('workspace-1', 'doc-1', 'doc-comment-1', {
      rowVersion: 1,
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(comment).toMatchObject({
      record_id: 'doc-comment-1',
      record_state: 'deleted',
      pg_record_type: 'doc_comment',
    });
  });

  it('deletes Tower PG messages and maps the local row as deleted', async () => {
    const api = await import('../src/api.js');
    api.deleteTowerPgMessage.mockResolvedValue({
      message: {
        id: 'message-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        body: 'Deleted',
        row_version: 2,
      },
    });

    const message = await deleteTowerPgMessageFromLocal(store(), {
      record_id: 'message-1',
      channel_id: 'channel-1',
      body: 'Deleted',
      version: 1,
    });

    expect(api.deleteTowerPgMessage).toHaveBeenCalledWith('workspace-1', 'message-1', {
      rowVersion: 1,
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(message).toMatchObject({
      record_id: 'message-1',
      record_state: 'deleted',
      pg_backend: true,
    });
  });

  it('treats missing Tower PG messages as already deleted locally', async () => {
    const api = await import('../src/api.js');
    const error = new Error('Tower PG API 404 DELETE https://tower.example/messages/message-missing: {"code":"message_not_found"}');
    error.status = 404;
    error.code = 'message_not_found';
    error.responseText = '{"error":"Flight Deck PG message not found","code":"message_not_found","status":404}';
    api.deleteTowerPgMessage.mockRejectedValue(error);

    const message = await deleteTowerPgMessageFromLocal(store(), {
      record_id: 'message-missing',
      channel_id: 'channel-1',
      body: 'Already gone',
      version: 2,
      pg_backend: true,
      record_state: 'active',
    });

    expect(api.deleteTowerPgMessage).toHaveBeenCalledWith('workspace-1', 'message-missing', {
      rowVersion: 2,
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(message).toMatchObject({
      record_id: 'message-missing',
      record_state: 'deleted',
      sync_status: 'synced',
      version: 3,
      pg_backend: true,
      pg_workspace_id: 'workspace-1',
    });
  });

  it('deletes Tower PG threads by PG thread id', async () => {
    const api = await import('../src/api.js');
    api.deleteTowerPgThread.mockResolvedValue({
      thread: { id: 'thread-1' },
    });

    const thread = await deleteTowerPgThreadFromLocal(store(), {
      record_id: 'message-1',
      pg_thread_id: 'thread-1',
    });

    expect(api.deleteTowerPgThread).toHaveBeenCalledWith('workspace-1', 'thread-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(thread).toEqual({ id: 'thread-1' });
  });

  it('archives Tower PG threads without a stale row version gate', async () => {
    const api = await import('../src/api.js');
    api.archiveTowerPgThread.mockResolvedValue({
      thread: { id: 'thread-1', record_state: 'archived', row_version: 7 },
    });

    const thread = await archiveTowerPgThreadFromLocal(store(), {
      record_id: 'message-1',
      pg_thread_id: 'thread-1',
      version: 1,
    }, true);

    expect(api.archiveTowerPgThread).toHaveBeenCalledWith('workspace-1', 'thread-1', {
      archived: true,
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(thread).toEqual({ id: 'thread-1', record_state: 'archived', row_version: 7 });
  });
});
