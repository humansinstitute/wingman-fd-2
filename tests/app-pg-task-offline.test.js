import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTaskById, openWorkspaceDb } from '../src/db.js';

const {
  alpineStartMock,
  alpineStoreMock,
  createTowerPgTaskFromLocalMock,
} = vi.hoisted(() => ({
  alpineStartMock: vi.fn(),
  alpineStoreMock: vi.fn(),
  createTowerPgTaskFromLocalMock: vi.fn(),
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

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
});

describe('app PG task offline drafts', () => {
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
});
