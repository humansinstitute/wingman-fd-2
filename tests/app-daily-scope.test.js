import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  alpineStartMock,
  alpineStoreMock,
  getTowerPgDailyNoteVersionsMock,
  getTowerPgDailyScopeAgentAccessMock,
  upsertDailyNoteMock,
  upsertTowerPgDailyNoteMock,
  upsertTowerPgDailyScopeAgentAccessMock,
} = vi.hoisted(() => ({
  alpineStartMock: vi.fn(),
  alpineStoreMock: vi.fn(),
  getTowerPgDailyNoteVersionsMock: vi.fn(),
  getTowerPgDailyScopeAgentAccessMock: vi.fn(),
  upsertDailyNoteMock: vi.fn(),
  upsertTowerPgDailyNoteMock: vi.fn(),
  upsertTowerPgDailyScopeAgentAccessMock: vi.fn(),
}));

vi.mock('alpinejs', () => ({
  default: {
    store: alpineStoreMock,
    start: alpineStartMock,
  },
}));

vi.mock('../src/api.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getTowerPgDailyNoteVersions: getTowerPgDailyNoteVersionsMock,
  getTowerPgDailyScopeAgentAccess: getTowerPgDailyScopeAgentAccessMock,
  upsertTowerPgDailyNote: upsertTowerPgDailyNoteMock,
  upsertTowerPgDailyScopeAgentAccess: upsertTowerPgDailyScopeAgentAccessMock,
}));

vi.mock('../src/db.js', async (importOriginal) => ({
  ...(await importOriginal()),
  upsertDailyNote: upsertDailyNoteMock,
}));

beforeEach(() => {
  vi.resetModules();
  alpineStartMock.mockClear();
  alpineStoreMock.mockClear();
  getTowerPgDailyNoteVersionsMock.mockReset();
  getTowerPgDailyScopeAgentAccessMock.mockReset();
  upsertDailyNoteMock.mockReset();
  upsertTowerPgDailyNoteMock.mockReset();
  upsertTowerPgDailyScopeAgentAccessMock.mockReset();
});

async function createStore() {
  const { initApp } = await import('../src/app.js');
  initApp();
  const store = alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
  expect(store).toBeTruthy();
  Object.assign(store, {
    backendUrl: 'https://tower.example',
    ownerNpub: 'npub-human',
    currentWorkspaceOwnerNpub: 'npub-human',
    selectedWorkspaceKey: 'workspace-key-1',
    knownWorkspaces: [{
      workspaceKey: 'workspace-key-1',
      workspaceId: 'workspace-1',
      workspaceOwnerNpub: 'npub-human',
      directHttpsUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      pgBackendMode: true,
    }],
  });
  return store;
}

describe('app Daily Scope behavior', () => {
  it('caps checklist editor items at five and saves checklist plus narrative', async () => {
    const store = await createStore();
    Object.assign(store, {
      dailyNotes: [{
        record_id: 'daily-1',
        owner_actor_id: 'owner-actor-1',
        owner_actor_npub: 'npub-human',
        note_date: '2026-06-17',
        title: 'Daily note',
        body: 'Old body',
        focus: '',
        items: [],
        metadata: { scope_id: 'scope-old', channel_id: null, source: 'manual' },
        status: 'active',
      }],
      dailyNoteEditorRecordId: 'daily-1',
      dailyNoteEditorTitle: 'Daily Scope',
      dailyNoteEditorBody: 'Morning narrative',
      dailyNoteEditorFocus: '',
      dailyNoteEditorItems: [],
      getTodayDateKey: () => '2026-06-17',
      getDailyNoteScopeMetadata: () => ({}),
    });
    for (let index = 0; index < 6; index += 1) {
      store.addDailyNoteEditorItem();
      if (store.dailyNoteEditorItems[index]) {
        store.dailyNoteEditorItems[index].text = `Focus ${index + 1}`;
      }
    }
    expect(store.dailyNoteEditorItems).toHaveLength(5);

    upsertTowerPgDailyNoteMock.mockResolvedValueOnce({
      daily_note: {
        id: 'daily-1',
        owner_actor_id: 'owner-actor-1',
        owner_actor_npub: 'npub-human',
        note_date: '2026-06-17',
        title: 'Daily Scope',
        body: 'Morning narrative',
        focus: 'Focus 1, Focus 2, Focus 3',
        items: store.dailyNoteEditorItemsForSave(),
        status: 'active',
        row_version: 2,
        updated_at: '2026-06-17T09:00:00.000Z',
      },
    });

    await store.saveDailyNoteEditor();

    expect(upsertTowerPgDailyNoteMock).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      note_date: '2026-06-17',
      owner_actor_id: 'owner-actor-1',
      body: 'Morning narrative',
      focus: 'Focus 1, Focus 2, Focus 3',
      items: expect.arrayContaining([expect.objectContaining({ text: 'Focus 1' })]),
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(upsertTowerPgDailyNoteMock.mock.calls[0][1].items).toHaveLength(5);
    expect(upsertTowerPgDailyNoteMock.mock.calls[0][1].metadata).toEqual({ source: 'manual' });
    expect(upsertTowerPgDailyNoteMock.mock.calls[0][1].scope_id).toBeNull();
    expect(upsertTowerPgDailyNoteMock.mock.calls[0][1].channel_id).toBeNull();
    expect(upsertDailyNoteMock).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'daily-1',
      body: 'Morning narrative',
      items: expect.arrayContaining([expect.objectContaining({ text: 'Focus 1' })]),
    }));
    expect(store.dailyNoteEditorOpen).toBe(false);
  });

  it('toggles the configured My Agent Daily Scope access and refreshes state', async () => {
    const store = await createStore();
    Object.assign(store, {
      workspaceHarnessAgentNpub: 'npub-agent',
      pgWorkspaceMembers: [{ actor_id: 'actor-agent', npub: 'npub-agent' }],
      dailyScopeAgentAccess: [],
    });
    upsertTowerPgDailyScopeAgentAccessMock.mockResolvedValueOnce({ access: { agent_actor_npub: 'npub-agent' } });
    getTowerPgDailyScopeAgentAccessMock.mockResolvedValueOnce({
      access: [{ agent_actor_npub: 'npub-agent', can_read: true, can_write: true, revoked_at: null }],
    });

    await store.toggleHarnessAgentDailyScopeAccess();

    expect(upsertTowerPgDailyScopeAgentAccessMock).toHaveBeenCalledWith('workspace-1', {
      agent_actor_id: 'actor-agent',
      agent_npub: 'npub-agent',
      can_read: true,
      can_write: true,
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(getTowerPgDailyScopeAgentAccessMock).toHaveBeenCalledWith('workspace-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(store.harnessAgentDailyScopeAccessEnabled).toBe(true);
  });

  it('refreshes workspace members before granting Daily Scope access when the agent actor id is not cached', async () => {
    const store = await createStore();
    Object.assign(store, {
      workspaceHarnessAgentNpub: 'npub-agent',
      pgWorkspaceMembers: [],
      dailyScopeAgentAccess: [],
      refreshTowerPgWorkspaceMembers: vi.fn(async () => {
        store.pgWorkspaceMembers = [{ actor_id: 'actor-agent', npub: 'npub-agent' }];
        return store.pgWorkspaceMembers;
      }),
    });
    upsertTowerPgDailyScopeAgentAccessMock.mockResolvedValueOnce({ access: { agent_actor_id: 'actor-agent' } });
    getTowerPgDailyScopeAgentAccessMock.mockResolvedValueOnce({
      access: [{ agent_actor_id: 'actor-agent', agent_actor_npub: 'npub-agent', can_read: true, can_write: true, revoked_at: null }],
    });

    await store.toggleHarnessAgentDailyScopeAccess();

    expect(store.refreshTowerPgWorkspaceMembers).toHaveBeenCalledWith({ force: true, limit: 200 });
    expect(upsertTowerPgDailyScopeAgentAccessMock).toHaveBeenCalledWith('workspace-1', {
      agent_actor_id: 'actor-agent',
      agent_npub: 'npub-agent',
      can_read: true,
      can_write: true,
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(store.harnessAgentDailyScopeAccessEnabled).toBe(true);
  });

  it('toggles a Daily Scope task from the overview and persists it', async () => {
    const store = await createStore();
    Object.assign(store, {
      dailyNotes: [{
        record_id: 'daily-1',
        owner_actor_id: 'owner-actor-1',
        owner_actor_npub: 'npub-human',
        note_date: '2026-06-17',
        title: 'Daily Scope',
        body: 'Private narrative',
        focus: 'Focus 1, Focus 2',
        items: [
          { id: 'task-1', text: 'Focus 1', completed: false, created_at: '2026-06-17T08:00:00.000Z' },
          { id: 'task-2', text: 'Focus 2', completed: true, created_at: '2026-06-17T08:05:00.000Z' },
        ],
        metadata: { source: 'manual', scope_id: 'scope-stale' },
        status: 'active',
        updated_at: '2026-06-17T08:10:00.000Z',
      }],
      getTodayDateKey: () => '2026-06-17',
    });
    upsertTowerPgDailyNoteMock.mockResolvedValueOnce({
      daily_note: {
        id: 'daily-1',
        owner_actor_id: 'owner-actor-1',
        owner_actor_npub: 'npub-human',
        note_date: '2026-06-17',
        title: 'Daily Scope',
        body: 'Private narrative',
        focus: 'Focus 1, Focus 2',
        items: [
          { id: 'task-1', text: 'Focus 1', completed: true },
          { id: 'task-2', text: 'Focus 2', completed: true },
        ],
        status: 'active',
        row_version: 2,
        updated_at: '2026-06-17T09:00:00.000Z',
      },
    });

    await store.toggleDailyNoteOverviewItem('task-1');

    expect(upsertTowerPgDailyNoteMock).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      note_date: '2026-06-17',
      owner_actor_id: 'owner-actor-1',
      scope_id: null,
      channel_id: null,
      body: 'Private narrative',
      metadata: { source: 'manual' },
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', text: 'Focus 1', completed: true }),
      ]),
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(upsertDailyNoteMock).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'daily-1',
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'task-1', completed: true }),
      ]),
    }));
  });

  it('creates a missing Daily Scope note for the selected overview date', async () => {
    const store = await createStore();
    Object.assign(store, {
      dailyNotes: [],
      dailyScopeSelectedDate: '2026-06-16',
      getTodayDateKey: () => '2026-06-17',
      getDailyNoteScopeMetadata: () => ({ scope_id: 'scope-current', channel_id: null }),
    });
    upsertTowerPgDailyNoteMock.mockResolvedValueOnce({
      daily_note: {
        id: 'daily-yesterday',
        owner_actor_id: 'owner-actor-1',
        owner_actor_npub: 'npub-human',
        note_date: '2026-06-16',
        title: 'Daily note',
        body: '',
        focus: '',
        items: [],
        status: 'active',
        row_version: 1,
        updated_at: '2026-06-16T09:00:00.000Z',
      },
    });

    await store.openDailyNoteEditor();

    expect(upsertTowerPgDailyNoteMock).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      note_date: '2026-06-16',
      title: 'Daily note',
      metadata: { source: 'manual' },
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(upsertTowerPgDailyNoteMock.mock.calls[0][1].scope_id).toBeNull();
    expect(upsertTowerPgDailyNoteMock.mock.calls[0][1].channel_id).toBeNull();
    expect(store.dailyNoteEditorOpen).toBe(true);
    expect(store.dailyNoteEditorRecordId).toBe('daily-yesterday');
  });

  it('loads and restores Daily Scope versions from Tower PG', async () => {
    const store = await createStore();
    Object.assign(store, {
      dailyNotes: [{
        record_id: 'daily-1',
        owner_actor_id: 'owner-actor-1',
        owner_actor_npub: 'npub-human',
        note_date: '2026-06-17',
        title: 'Daily Scope',
        body: 'Current body',
        focus: 'Current focus',
        items: [{ id: 'task-1', text: 'Current item', completed: false }],
        metadata: { source: 'manual' },
        status: 'active',
        row_version: 3,
      }],
      dailyNoteEditorRecordId: 'daily-1',
      dailyNoteEditorTitle: 'Daily Scope',
      dailyNoteEditorBody: 'Current body',
      dailyNoteEditorFocus: 'Current focus',
      dailyNoteEditorItems: [{ id: 'task-1', text: 'Current item', completed: false }],
      getTodayDateKey: () => '2026-06-17',
    });
    getTowerPgDailyNoteVersionsMock.mockResolvedValueOnce({
      versions: [
        {
          row_version: 3,
          title: 'Daily Scope',
          body: 'Current body',
          focus: 'Current focus',
          items: [{ id: 'task-1', text: 'Current item', completed: false }],
          updated_at: '2026-06-17T10:00:00.000Z',
        },
        {
          row_version: 2,
          title: 'Daily Scope',
          body: 'Previous body',
          focus: 'Previous focus',
          items: [{ id: 'task-1', text: 'Previous item', completed: true }],
          updated_at: '2026-06-17T09:00:00.000Z',
        },
      ],
    });
    upsertTowerPgDailyNoteMock.mockResolvedValueOnce({
      daily_note: {
        id: 'daily-1',
        owner_actor_id: 'owner-actor-1',
        owner_actor_npub: 'npub-human',
        note_date: '2026-06-17',
        title: 'Daily Scope',
        body: 'Previous body',
        focus: 'Previous focus',
        items: [{ id: 'task-1', text: 'Previous item', completed: true }],
        status: 'active',
        row_version: 4,
        updated_at: '2026-06-17T10:15:00.000Z',
      },
    });

    await store.openDailyNoteVersioning();

    expect(getTowerPgDailyNoteVersionsMock).toHaveBeenCalledWith('workspace-1', 'daily-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      limit: 50,
    });
    expect(store.dailyNoteVersionHistory).toHaveLength(2);
    store.selectDailyNoteVersion(1);
    await store.restoreDailyNoteVersion();

    expect(store.dailyNoteEditorBody).toBe('Previous body');
    expect(store.dailyNoteEditorFocus).toBe('Previous focus');
    expect(upsertTowerPgDailyNoteMock).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      title: 'Daily Scope',
      body: 'Previous body',
      focus: 'Previous focus',
      items: [expect.objectContaining({ text: 'Previous item', completed: true })],
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(store.dailyNoteVersioningOpen).toBe(false);
  });
});
