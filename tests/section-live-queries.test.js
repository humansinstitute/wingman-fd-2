import { describe, expect, it, vi } from 'vitest';

import { openWorkspaceDb } from '../src/db.js';
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
    expect(plan.detail).toEqual([
      'chat:messages:channel-1',
      'chat:reactions:channel-1',
      'chat:channel-response-activities:channel-1',
    ]);
  });

  it('subscribes to active thread response activities by PG thread id when available', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'chat',
      selectedChannelId: 'channel-1',
      activeThreadId: 'root-message-1',
      messages: [{ record_id: 'root-message-1', pg_thread_id: 'pg-thread-1' }],
      applyAddressBookPeople() {},
    });

    expect(plan.detail).toContain('chat:response-activities:pg-thread-1');
  });

  it('subscribes to all current scope channels on chat scope home', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'chat',
      selectedChannelId: null,
      pgContextChannels: [
        { record_id: 'channel-a' },
        { record_id: 'channel-b' },
      ],
      applyAddressBookPeople() {},
    });

    expect(plan.detail).toEqual([
      'chat:messages:scope-home:channel-a,channel-b',
      'chat:reactions:scope-home:channel-a,channel-b',
    ]);
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
      'status:messages',
      'status:comments',
      'status:directories',
      'status:documents',
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

  it('keeps PG file folders hot on the files route', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      currentWorkspace: { workspaceId: 'workspace-1' },
      navSection: 'files',
      applyAddressBookPeople() {},
    });

    expect(plan.workspace).toEqual([
      'ws:scopes',
      'ws:channels',
      'files:messages',
      'files:comments',
      'files:audio-notes',
      'files:directories',
      'files:documents',
      'files:file-folders',
      'files:tasks',
    ]);
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

  it('stops workspace subscriptions when the workspace key changes', () => {
    const subscriptions = [];
    const store = {
      currentWorkspaceKey: 'workspace-a',
      workspaceOwnerNpub: 'npub1owner',
      navSection: 'chat',
      selectedChannelId: 'channel-a',
      startSharedLiveQueries: vi.fn(),
      createLiveSubscription: vi.fn(() => {
        const subscription = { unsubscribe: vi.fn() };
        subscriptions.push(subscription);
        return subscription;
      }),
      stopLiveSubscription: vi.fn((subscription) => subscription.unsubscribe()),
      initUnreadTracking: vi.fn(),
      applyScopes: vi.fn(),
      applyChannels: vi.fn(),
      applyAudioNotes: vi.fn(),
      applyMessages: vi.fn(),
      applyReactions: vi.fn(),
      applyChannelResponseActivities: vi.fn(),
    };

    openWorkspaceDb('workspace-a');
    sectionLiveQueryMixin.startWorkspaceLiveQueries.call(store);
    expect(subscriptions.length).toBeGreaterThan(0);

    store.currentWorkspaceKey = 'workspace-b';
    openWorkspaceDb('workspace-b');
    sectionLiveQueryMixin.startWorkspaceLiveQueries.call(store);

    expect(subscriptions[0].unsubscribe).toHaveBeenCalled();
    expect(store.stopLiveSubscription).toHaveBeenCalled();
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

    openWorkspaceDb(store.currentWorkspaceKey);
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

  it('refreshes Tower PG tasks when the task board route becomes active after workspace hydration', async () => {
    const store = {
      currentWorkspace: {
        pgBackendMode: true,
        workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
        workspaceId: 'workspace-1',
      },
      currentWorkspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      selectedBoardId: 'scope-1',
      session: { npub: 'npub1user' },
      backendUrl: 'https://tower.example',
      navSection: 'chat',
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

    openWorkspaceDb(store.currentWorkspaceKey);
    sectionLiveQueryMixin.startWorkspaceLiveQueries.call(store);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.refreshTasks).toHaveBeenCalledTimes(1);

    store.navSection = 'tasks';
    sectionLiveQueryMixin.startWorkspaceLiveQueries.call(store);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.refreshTasks).toHaveBeenCalledTimes(2);
  });

  it('refreshes Tower PG files when the files route becomes active', async () => {
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
      navSection: 'files',
      pgContextSelectedChannelId: 'channel-1',
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

    openWorkspaceDb(store.currentWorkspaceKey);
    sectionLiveQueryMixin.startWorkspaceLiveQueries.call(store);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.refreshDocuments).toHaveBeenCalled();
  });
});
