import { afterEach, describe, expect, it, vi } from 'vitest';
import { wappsManagerMixin } from '../src/wapps-manager.js';
import { ALL_TASK_BOARD_ID, UNSCOPED_TASK_BOARD_ID } from '../src/task-board-state.js';

function createStore(overrides = {}) {
  const store = {
    workspaceOwnerNpub: 'npub_workspace',
    selectedBoardId: ALL_TASK_BOARD_ID,
    selectedBoardScope: null,
    scopesMap: {},
    getScopeBreadcrumb: vi.fn((scopeId) => `Scope ${scopeId}`),
    ...overrides,
  };
  Object.defineProperties(store, Object.getOwnPropertyDescriptors(wappsManagerMixin));
  if (overrides.wapps) store.wapps = overrides.wapps;
  return store;
}

function wapp(overrides = {}) {
  return {
    record_id: 'wapp-record-1',
    owner_npub: 'npub_workspace',
    workspace_owner_npub: 'npub_workspace',
    title: 'Budget Builder',
    description: 'Prepare a scope budget.',
    launch_url: 'https://apps.example.test/budget',
    scope_id: 'scope-project',
    scope_l1_id: 'scope-product',
    scope_l2_id: 'scope-project',
    record_state: 'active',
    updated_at: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

describe('wapps manager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters archived and other-workspace apps', () => {
    const store = createStore({
      wapps: [
        wapp({ record_id: 'visible' }),
        wapp({ record_id: 'archived', record_state: 'archived' }),
        wapp({ record_id: 'status-archived', status: 'archived' }),
        wapp({ record_id: 'other-workspace', workspace_owner_npub: 'npub_other' }),
      ],
    });

    expect(store.visibleWapps.map((item) => item.record_id)).toEqual(['visible']);
  });

  it('keeps archived apps manageable in setup', () => {
    const store = createStore({
      wapps: [
        wapp({ record_id: 'visible' }),
        wapp({ record_id: 'archived', status: 'archived', record_state: 'archived' }),
        wapp({ record_id: 'deleted', record_state: 'deleted' }),
      ],
    });

    expect(store.manageableWapps.map((item) => item.record_id).sort()).toEqual(['archived', 'visible']);
  });

  it('hides child-scoped apps from parent boards', () => {
    const store = createStore({
      selectedBoardId: 'scope-project',
      selectedBoardScope: {
        record_id: 'scope-project',
        l1_id: 'scope-product',
        l2_id: 'scope-project',
      },
      wapps: [
        wapp({ record_id: 'project-app', scope_id: 'scope-project', scope_l1_id: 'scope-product', scope_l2_id: 'scope-project' }),
        wapp({ record_id: 'deliverable-app', scope_id: 'scope-deliverable', scope_l1_id: 'scope-product', scope_l2_id: 'scope-project', scope_l3_id: 'scope-deliverable' }),
      ],
    });

    expect(store.visibleWapps.map((item) => item.record_id)).toEqual(['project-app']);
  });

  it('shows apps scoped to child boards and inherited ancestor scopes only', () => {
    const store = createStore({
      selectedBoardId: 'scope-deliverable',
      selectedBoardScope: {
        record_id: 'scope-deliverable',
        l1_id: 'scope-product',
        l2_id: 'scope-project',
        l3_id: 'scope-deliverable',
      },
      wapps: [
        wapp({ record_id: 'project-app', scope_id: 'scope-project', scope_l1_id: 'scope-product', scope_l2_id: 'scope-project' }),
        wapp({ record_id: 'deliverable-app', scope_id: 'scope-deliverable', scope_l1_id: 'scope-product', scope_l2_id: 'scope-project', scope_l3_id: 'scope-deliverable' }),
        wapp({ record_id: 'other-app', scope_id: 'scope-other', scope_l1_id: 'scope-other', scope_l2_id: null }),
      ],
    });

    expect(store.visibleWapps.map((item) => item.record_id).sort()).toEqual(['deliverable-app', 'project-app']);
  });

  it('opens launch URLs in a new noopener tab', () => {
    const open = vi.fn(() => ({ opener: {} }));
    vi.stubGlobal('window', { open });
    const store = createStore();

    store.openWapp(wapp());

    expect(open).toHaveBeenCalledWith('https://apps.example.test/budget', '_blank', 'noopener,noreferrer');
    vi.unstubAllGlobals();
  });

  it('shows unscoped apps only when the unscoped focus is active', () => {
    const store = createStore({
      selectedBoardId: UNSCOPED_TASK_BOARD_ID,
      wapps: [
        wapp({ record_id: 'scoped' }),
        wapp({ record_id: 'unscoped', scope_id: null, scope_l1_id: null, scope_l2_id: null }),
      ],
    });

    expect(store.visibleWapps.map((item) => item.record_id)).toEqual(['unscoped']);
  });

  it('shows scheduled apps only inside their active window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T08:30:00.000Z'));
    const store = createStore({
      wapps: [
        wapp({
          record_id: 'morning',
          schedule: {
            timezone: 'UTC',
            windows: [{ days: [5], start_time: '06:00', end_time: '12:00' }],
          },
        }),
        wapp({
          record_id: 'evening',
          schedule: {
            timezone: 'UTC',
            windows: [{ days: [5], start_time: '18:00', end_time: '22:00' }],
          },
        }),
      ],
    });

    expect(store.visibleWapps.map((item) => item.record_id)).toEqual(['morning']);
  });

  it('supports scheduled windows that cross midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T01:30:00.000Z'));
    const store = createStore({
      wapps: [
        wapp({
          record_id: 'overnight',
          schedule: {
            timezone: 'UTC',
            windows: [{ days: [5], start_time: '22:00', end_time: '02:00' }],
          },
        }),
      ],
    });

    expect(store.visibleWapps.map((item) => item.record_id)).toEqual(['overnight']);
  });

  it('opens a visibility edit draft from an existing schedule', () => {
    const store = createStore({
      wapps: [
        wapp({
          record_id: 'morning',
          schedule: {
            timezone: 'UTC',
            windows: [{ start_time: '06:00', end_time: '12:00' }],
          },
        }),
      ],
    });

    store.startEditWappVisibility('morning');

    expect(store.editingWappVisibilityDraft).toMatchObject({
      record_id: 'morning',
      status: 'active',
      schedule_enabled: true,
      timezone: 'UTC',
      start_time: '06:00',
      end_time: '12:00',
      days: [0, 1, 2, 3, 4, 5, 6],
    });
  });
});
