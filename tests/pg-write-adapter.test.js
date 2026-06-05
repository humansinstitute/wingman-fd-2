import { describe, expect, it, vi } from 'vitest';
import {
  createTowerPgMessageFromLocal,
  createTowerPgTaskFromLocal,
  resolveTowerPgTaskChannel,
  updateTowerPgTaskFromLocal,
} from '../src/pg-write-adapter.js';

vi.mock('../src/api.js', () => ({
  createTowerPgChannelMessage: vi.fn(),
  createTowerPgChannelTask: vi.fn(),
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

  it('falls back to a visible channel under the task scope', () => {
    expect(resolveTowerPgTaskChannel(store({ selectedChannelId: 'channel-1' }), { scope_id: 'scope-2' })).toMatchObject({
      record_id: 'channel-2',
    });
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
});
