import { describe, expect, it, vi } from 'vitest';
import {
  createTowerPgAudioNoteFromLocal,
  createTowerPgDocFromLocal,
  createTowerPgFileFromLocal,
  createTowerPgMessageFromLocal,
  createTowerPgTaskFromLocal,
  resolveTowerPgTaskChannel,
  updateTowerPgTaskFromLocal,
} from '../src/pg-write-adapter.js';
import { recordFamilyHash } from '../src/translators/chat.js';

vi.mock('../src/api.js', () => ({
  createTowerPgChannelAudioNote: vi.fn(),
  createTowerPgChannelDoc: vi.fn(),
  createTowerPgChannelFile: vi.fn(),
  createTowerPgChannelMessage: vi.fn(),
  createTowerPgChannelTask: vi.fn(),
  getTowerPgChannelAudioNotes: vi.fn(),
  getTowerPgChannelDocs: vi.fn(),
  getTowerPgChannelFiles: vi.fn(),
  getTowerPgChannelMessages: vi.fn(),
  getTowerPgChannelTasks: vi.fn(),
  getTowerPgChannelThreads: vi.fn(),
  getTowerPgScopeChannels: vi.fn(),
  getTowerPgScopeTasks: vi.fn(),
  getTowerPgWorkspaceScopes: vi.fn(),
  updateTowerPgTask: vi.fn(),
  updateTowerPgTaskState: vi.fn(),
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
      metadata: { board_order: null, tags: '' },
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(task).toMatchObject({ record_id: 'task-1', pg_channel_id: 'channel-1' });
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

  it('rejects PG task creation when the selected channel mismatches the task scope', async () => {
    await expect(createTowerPgTaskFromLocal(store({ selectedChannelId: 'channel-1' }), {
      title: 'Task',
      scope_id: 'scope-2',
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

    expect(api.createTowerPgChannelAudioNote).toHaveBeenCalledWith('workspace-1', 'channel-1', expect.objectContaining({
      storage_object_id: 'storage-audio',
      thread_id: 'thread-1',
      target_type: 'message',
      target_id: 'message-1',
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
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

    const task = await updateTowerPgTaskFromLocal(store(), {
      record_id: 'task-1',
      title: 'Task',
      state: 'done',
      priority: 'sand',
      version: 2,
    }, { version: 1 }, { state: 'done' });

    expect(api.updateTowerPgTaskState).toHaveBeenCalledWith('workspace-1', 'task-1', {
      row_version: 1,
      state: 'done',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(task).toMatchObject({ record_id: 'task-1', state: 'done', version: 2 });
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
      channel_id: 'channel-1',
      body: 'Hello',
    });

    expect(api.createTowerPgChannelMessage).toHaveBeenCalledWith('workspace-1', 'channel-1', {
      body: 'Hello',
      create_thread: true,
      thread_title: 'Hello',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(message).toMatchObject({ record_id: 'message-1', parent_message_id: null, pg_thread_id: 'thread-1' });
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
      thread_id: 'thread-1',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(message).toMatchObject({
      record_id: 'reply-1',
      parent_message_id: 'root-message-1',
      pg_thread_id: 'thread-1',
    });
  });
});
