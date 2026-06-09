import { describe, expect, it, vi } from 'vitest';

import { getSectionLiveQueryPlan, sectionLiveQueryMixin } from '../src/section-live-queries.js';

describe('section live query plan', () => {
  it('keeps only chat list and active detail subscriptions hot on the chat route', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'chat',
      selectedChannelId: 'channel-1',
      applyAddressBookPeople() {},
    });

    expect(plan.shared).toEqual(['address-book']);
    expect(plan.workspace).toEqual(['ws:scopes', 'ws:channels', 'chat:audio-notes']);
    expect(plan.detail).toEqual(['chat:messages:channel-1', 'chat:reactions:channel-1']);
  });

  it('switches task route to its own workspace slices and keeps disabled reports cold', () => {
    const taskPlan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'tasks',
      activeTaskId: 'task-1',
      applyAddressBookPeople() {},
    });
    expect(taskPlan.workspace).toEqual(['ws:scopes', 'ws:channels', 'tasks:tasks', 'tasks:documents']);
    expect(taskPlan.detail).toEqual([
      'tasks:selected-task:task-1',
      'tasks:comments:task-1',
      'tasks:comment-reactions:task-1',
    ]);

    const reportPlan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'reports',
      selectedReportId: 'report-1',
      applyAddressBookPeople() {},
    });
    expect(reportPlan.workspace).toEqual(['ws:scopes', 'ws:channels']);
    expect(reportPlan.detail).toEqual([]);
  });

  it('keeps the flight deck route subscribed to the records it renders', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'status',
      applyAddressBookPeople() {},
    });

    expect(plan.shared).toEqual(['address-book']);
    expect(plan.workspace).toEqual([
      'ws:scopes',
      'ws:channels',
      'status:wapps',
      'status:tasks',
    ]);
    expect(plan.detail).toEqual([]);
  });

  it('keeps doc comments cold until a document is open', () => {
    const browserPlan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'docs',
      selectedDocType: null,
      selectedDocId: null,
      applyAddressBookPeople() {},
    });
    expect(browserPlan.workspace).toEqual(['ws:scopes', 'ws:channels', 'docs:directories', 'docs:documents']);
    expect(browserPlan.detail).toEqual([]);

    const detailPlan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'docs',
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      applyAddressBookPeople() {},
    });
    expect(detailPlan.detail).toEqual([
      'docs:selected-doc:doc-1',
      'docs:comments:doc-1',
      'docs:comment-reactions:doc-1',
    ]);
  });

  it('keeps disabled settings surfaces cold in the settings section', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'settings',
      applyAddressBookPeople() {},
    });

    expect(plan.workspace).toEqual(['ws:scopes', 'ws:channels']);
    expect(plan.detail).toEqual([]);
  });

  it('keeps disabled CRM records cold on the opportunities route', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'opportunities',
      activeOpportunityId: 'opp-1',
      applyAddressBookPeople() {},
    });

    expect(plan.workspace).toEqual(['ws:scopes', 'ws:channels']);
    expect(plan.detail).toEqual([]);
  });

  it('kicks Tower PG hydration when a workspace is restored from cache', async () => {
    const store = {
      currentWorkspace: {
        pgBackendMode: true,
        workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
        workspaceId: 'workspace-1',
      },
      currentWorkspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      session: { npub: 'npub1user' },
      backendUrl: 'https://tower.example',
      navSection: 'tasks',
      startSharedLiveQueries: vi.fn(),
      createLiveSubscription: vi.fn(() => ({ unsubscribe() {} })),
      stopLiveSubscription: vi.fn(),
      initUnreadTracking: vi.fn(),
      loadLocalWorkspaceCoreData: vi.fn(async () => ({ scopes: [], channels: [] })),
      refreshGroups: vi.fn(async () => []),
      refreshScopes: vi.fn(async () => []),
      refreshChannels: vi.fn(async () => []),
      refreshTasks: vi.fn(async () => []),
      refreshDocuments: vi.fn(async () => []),
      refreshAudioNotes: vi.fn(async () => []),
    };

    sectionLiveQueryMixin.startWorkspaceLiveQueries.call(store);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.loadLocalWorkspaceCoreData).toHaveBeenCalledWith({ syncRoute: false });
    expect(store.refreshGroups).toHaveBeenCalledWith({ force: true, minIntervalMs: 0 });
    expect(store.refreshScopes).toHaveBeenCalledTimes(1);
    expect(store.refreshChannels).toHaveBeenCalledTimes(1);
    expect(store.refreshTasks).toHaveBeenCalledTimes(1);
    expect(store.refreshDocuments).toHaveBeenCalledTimes(1);
    expect(store.refreshAudioNotes).toHaveBeenCalledTimes(1);
  });
});
