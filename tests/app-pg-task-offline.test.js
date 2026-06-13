import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTaskById, openWorkspaceDb } from '../src/db.js';

const {
  alpineStartMock,
  alpineStoreMock,
  createTowerPgTaskFromLocalMock,
  releaseTowerPgEditLeaseMock,
} = vi.hoisted(() => ({
  alpineStartMock: vi.fn(),
  alpineStoreMock: vi.fn(),
  createTowerPgTaskFromLocalMock: vi.fn(),
  releaseTowerPgEditLeaseMock: vi.fn(),
}));

vi.mock('alpinejs', () => ({
  default: {
    store: alpineStoreMock,
    start: alpineStartMock,
  },
}));

vi.mock('../src/pg-write-adapter.js', () => ({
  createTowerPgAudioNoteFromLocal: vi.fn(),
  createTowerPgDocFromLocal: vi.fn(),
  createTowerPgFileFromLocal: vi.fn(),
  createTowerPgMessageFromLocal: vi.fn(),
  createTowerPgTaskCommentFromLocal: vi.fn(),
  createTowerPgTaskFromLocal: createTowerPgTaskFromLocalMock,
  deleteTowerPgDocFromLocal: vi.fn(),
  resolveTowerPgTaskChannel: vi.fn(),
  updateTowerPgDocFromLocal: vi.fn(),
  updateTowerPgTaskFromLocal: vi.fn(),
}));

vi.mock('../src/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  releaseTowerPgEditLease: releaseTowerPgEditLeaseMock,
}));

beforeEach(() => {
  alpineStartMock.mockClear();
  alpineStoreMock.mockClear();
  createTowerPgTaskFromLocalMock.mockReset();
  releaseTowerPgEditLeaseMock.mockReset();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
});

describe('app PG task offline drafts', () => {
  it('replaces the optimistic local task row when Tower accepts a PG create', async () => {
    const wsDb = openWorkspaceDb('npub1pgworkspace-create');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    createTowerPgTaskFromLocalMock.mockResolvedValueOnce({
      record_id: 'pg-task-1',
      owner_npub: 'npub1pgworkspace-create',
      title: 'Online PG task',
      description: '',
      state: 'new',
      priority: 'sand',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      pg_backend: true,
      pg_record_type: 'task',
      pg_channel_id: 'channel-1',
    });

    const { initApp } = await import('../src/app.js');
    initApp();
    const store = alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
    expect(store).toBeTruthy();

    Object.assign(store, {
      session: { npub: 'npub1owner' },
      ownerNpub: 'npub1pgworkspace-create',
      currentWorkspaceOwnerNpub: 'npub1pgworkspace-create',
      selectedWorkspaceKey: 'workspace-1',
      knownWorkspaces: [{
        workspaceKey: 'workspace-1',
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace-create',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
        pgBackendMode: true,
      }],
      backendUrl: 'https://tower.example',
      channels: [{ record_id: 'channel-1', scope_id: 'scope-1', scope_l1_id: 'scope-1', record_state: 'active' }],
      selectedChannelId: 'channel-1',
      selectedBoardId: 'scope-1',
      newTaskTitle: 'Online PG task',
      tasks: [],
      buildTaskBoardAssignment: vi.fn(() => ({
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        scope_policy_group_ids: null,
        board_group_id: null,
        shares: [],
        group_ids: [],
      })),
      refreshTasks: vi.fn(async () => store.tasks),
      scheduleTasksRefresh: vi.fn(),
    });

    const acceptedTask = await store.addTask({ channelId: 'channel-1', scopeId: 'scope-1' });
    const localTask = createTowerPgTaskFromLocalMock.mock.calls[0]?.[1];

    expect(acceptedTask.record_id).toBe('pg-task-1');
    expect(localTask.record_id).not.toBe('pg-task-1');
    expect(await getTaskById(localTask.record_id)).toBeUndefined();
    expect(await getTaskById('pg-task-1')).toMatchObject({ title: 'Online PG task', sync_status: 'synced' });
    expect(store.tasks.map((task) => task.record_id)).toEqual(['pg-task-1']);
  });

  it('creates a local PG task offline and keeps it editable until Tower accepts it', async () => {
    const wsDb = openWorkspaceDb('npub1pgworkspace');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    });
    createTowerPgTaskFromLocalMock.mockRejectedValueOnce(new Error('offline'));

    const { initApp } = await import('../src/app.js');
    initApp();
    const store = alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
    expect(store).toBeTruthy();

    Object.assign(store, {
      session: { npub: 'npub1owner' },
      ownerNpub: 'npub1pgworkspace',
      currentWorkspaceOwnerNpub: 'npub1pgworkspace',
      selectedWorkspaceKey: 'workspace-1',
      knownWorkspaces: [{
        workspaceKey: 'workspace-1',
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
        pgBackendMode: true,
      }],
      backendUrl: 'https://tower.example',
      channels: [{ record_id: 'channel-1', scope_id: 'scope-1', scope_l1_id: 'scope-1', record_state: 'active' }],
      selectedChannelId: 'channel-1',
      selectedBoardId: 'scope-1',
      newTaskTitle: 'Offline PG task',
      tasks: [],
      buildTaskBoardAssignment: vi.fn(() => ({
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        scope_policy_group_ids: null,
        board_group_id: null,
        shares: [],
        group_ids: [],
      })),
      refreshTasks: vi.fn(async () => store.tasks),
    });

    const localTask = await store.addTask({ channelId: 'channel-1', scopeId: 'scope-1' });

    expect(localTask).toMatchObject({
      title: 'Offline PG task',
      pg_backend: true,
      pg_record_type: 'task',
      pg_channel_id: 'channel-1',
      sync_status: 'failed',
    });
    expect(store.error).toBe('PG task saved locally. Reconnect to sync it.');
    expect(await getTaskById(localTask.record_id)).toMatchObject({ sync_status: 'failed' });

    const edited = await store.applyTaskPatch(localTask.record_id, { title: 'Offline PG task edited' }, {
      env: { navigator: { onLine: false } },
    });

    expect(edited).toMatchObject({
      record_id: localTask.record_id,
      title: 'Offline PG task edited',
      sync_status: 'failed',
      pg_backend: true,
    });
    expect(createTowerPgTaskFromLocalMock).toHaveBeenCalledTimes(1);
    expect(await getTaskById(localTask.record_id)).toMatchObject({
      title: 'Offline PG task edited',
      sync_status: 'failed',
    });
  });

  it('releases a held synced PG task lease when switching task detail routes', async () => {
    releaseTowerPgEditLeaseMock.mockResolvedValueOnce({ released: true });
    const { initApp } = await import('../src/app.js');
    initApp();
    const store = alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
    expect(store).toBeTruthy();

    Object.assign(store, {
      session: { npub: 'npub1owner' },
      ownerNpub: 'npub1pgworkspace',
      currentWorkspaceOwnerNpub: 'npub1pgworkspace',
      selectedWorkspaceKey: 'workspace-1',
      knownWorkspaces: [{
        workspaceKey: 'workspace-1',
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
        pgBackendMode: true,
      }],
      backendUrl: 'https://tower.example',
      tasks: [
        {
          record_id: 'task-1',
          title: 'Synced PG task',
          pg_backend: true,
          sync_status: 'synced',
          record_state: 'active',
        },
        {
          record_id: 'task-2',
          title: 'Next synced PG task',
          pg_backend: true,
          sync_status: 'synced',
          record_state: 'active',
        },
      ],
      activeTaskId: 'task-1',
      editingTask: {
        record_id: 'task-1',
        title: 'Synced PG task',
        pg_backend: true,
        sync_status: 'synced',
        record_state: 'active',
      },
      taskDetailMode: 'edit',
      pgEditLeaseSessions: {
        'task:task-1': {
          acquireState: 'held',
          lease: { id: 'lease-task-1', lease_token: 'task-token-1' },
        },
      },
      pgEditLeaseRenewalTimers: {
        'task:task-1': 123,
      },
      loadTaskComments: vi.fn(),
      scheduleStorageImageHydration: vi.fn(),
      markTaskRead: vi.fn(),
      syncRoute: vi.fn(),
    });

    store.openTaskDetail('task-2');

    expect(releaseTowerPgEditLeaseMock).toHaveBeenCalledWith('workspace-1', 'lease-task-1', {
      lease_token: 'task-token-1',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(store.pgEditLeaseSessions['task:task-1']).toBeUndefined();
    expect(store.pgEditLeaseRenewalTimers['task:task-1']).toBeUndefined();
    expect(store.activeTaskId).toBe('task-2');
    expect(store.editingTask.record_id).toBe('task-2');
    expect(store.taskDetailMode).toBe('view');
  });

  it('does not use PG lease release when switching from an encrypted-record task detail edit', async () => {
    const { initApp } = await import('../src/app.js');
    initApp();
    const store = alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
    expect(store).toBeTruthy();

    Object.assign(store, {
      tasks: [
        { record_id: 'task-classic-1', title: 'Classic task', record_state: 'active' },
        { record_id: 'task-classic-2', title: 'Next classic task', record_state: 'active' },
      ],
      activeTaskId: 'task-classic-1',
      editingTask: { record_id: 'task-classic-1', title: 'Classic task', record_state: 'active' },
      taskDetailMode: 'edit',
      pgEditLeaseSessions: {},
      pgEditLeaseRenewalTimers: {},
      loadTaskComments: vi.fn(),
      scheduleStorageImageHydration: vi.fn(),
      markTaskRead: vi.fn(),
      syncRoute: vi.fn(),
    });

    store.openTaskDetail('task-classic-2');

    expect(releaseTowerPgEditLeaseMock).not.toHaveBeenCalled();
    expect(store.activeTaskId).toBe('task-classic-2');
    expect(store.editingTask.record_id).toBe('task-classic-2');
  });
});
