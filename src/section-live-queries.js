import {
  getAddressBookPeople,
  getChannelsByOwner,
  getCommentsByOwner,
  getMessagesByChannel,
  getMessagesByChannels,
  getMessagesByOwner,
  getAudioNotesByOwner,
  getDirectoriesByOwner,
  getDocumentsByOwner,
  getDocumentById,
  getWindowedDocumentsByOwner,
  getReportById,
  getWindowedReportsByOwner,
  getTaskById,
  getTasksByOwner,
  getSchedulesByOwner,
  getScopesByOwner,
  getCommentsByTarget,
  getReactionsByTargets,
  getResponseActivitiesForChannel,
  getResponseActivitiesForTarget,
  isWorkspaceDbOpenForKey,
} from './db.js';
import { recordFamilyHash } from './translators/chat.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import { isFlightDeckSurfaceDisabled } from './disabled-surfaces.js';
import { flightDeckLog } from './logging.js';
import { resolvePgThreadId } from './pg-record-context.js';

const SECTION_STATE = new WeakMap();

function getSectionState(store) {
  let state = SECTION_STATE.get(store);
  if (!state) {
    state = {
      shared: new Map(),
      workspace: new Map(),
      detail: new Map(),
      workspaceKey: '',
      workspaceOwnerNpub: '',
      pgHydratingWorkspaceKeys: new Set(),
      pgHydratedWorkspaceKeys: new Set(),
      pgRefreshingTaskBoardKeys: new Set(),
      pgTaskBoardRefreshAt: new Map(),
    };
    SECTION_STATE.set(store, state);
  }
  return state;
}

function stopSubscription(store, subscription) {
  if (!subscription || typeof store?.stopLiveSubscription !== 'function') return;
  store.stopLiveSubscription(subscription);
}

function syncBucket(store, bucket, specs) {
  const desiredKeys = new Set();

  for (const spec of specs) {
    if (!spec?.key) continue;
    desiredKeys.add(spec.key);
    if (bucket.has(spec.key)) continue;
    const subscription = store.createLiveSubscription(spec.query, spec.onNext);
    bucket.set(spec.key, subscription);
  }

  for (const [key, subscription] of bucket.entries()) {
    if (desiredKeys.has(key)) continue;
    stopSubscription(store, subscription);
    bucket.delete(key);
  }
}

function stopBucket(store, bucket) {
  for (const subscription of bucket.values()) {
    stopSubscription(store, subscription);
  }
  bucket.clear();
}

function scheduleTowerPgWorkspaceHydration(store, state) {
  if (!isTowerPgBackendMode()) return;
  if (!store?.currentWorkspace?.pgBackendMode) return;
  if (!store?.session?.npub) return;
  if (!store?.backendUrl) return;
  const workspaceKey = String(store.currentWorkspaceKey || store.currentWorkspace?.workspaceKey || '').trim();
  if (!workspaceKey) return;
  if (!isWorkspaceDbOpenForKey(workspaceKey)) return;
  if (state.pgHydratingWorkspaceKeys.has(workspaceKey) || state.pgHydratedWorkspaceKeys.has(workspaceKey)) return;

  state.pgHydratingWorkspaceKeys.add(workspaceKey);
  Promise.resolve()
    .then(async () => {
      if (String(store.currentWorkspaceKey || '') !== workspaceKey) return;
      await store.loadLocalWorkspaceCoreData?.({ syncRoute: false });
      if (String(store.currentWorkspaceKey || '') !== workspaceKey) return;
      await store.refreshGroups?.({ force: true, minIntervalMs: 0 });
      await store.refreshScopes?.();
      await store.refreshChannels?.();
      state.pgHydratedWorkspaceKeys.add(workspaceKey);
      const optionalRefreshes = [
        ['tasks', () => store.refreshTasks?.()],
        ['documents', () => store.refreshDocuments?.()],
        ['audio-notes', () => store.refreshAudioNotes?.()],
      ];
      await Promise.all(optionalRefreshes.map(async ([label, refresh]) => {
        try {
          await refresh();
        } catch (error) {
          flightDeckLog('debug', 'pg', 'optional Tower PG hydration refresh failed', {
            workspaceKey,
            surface: label,
            error: error?.message || String(error),
          });
        }
      }));
    })
    .catch((error) => {
      state.pgHydratedWorkspaceKeys.delete(workspaceKey);
      flightDeckLog('warn', 'pg', 'Tower PG workspace hydration failed after live-query startup', {
        workspaceKey,
        error: error?.message || String(error),
      });
    })
    .finally(() => {
      state.pgHydratingWorkspaceKeys.delete(workspaceKey);
    });
}

const PG_TASK_BOARD_REFRESH_MIN_MS = 5000;

function buildTowerPgTaskBoardRefreshKey(store) {
  const workspaceKey = String(store?.currentWorkspaceKey || store?.currentWorkspace?.workspaceKey || '').trim();
  if (!workspaceKey) return '';
  const boardId = String(store?.selectedBoardId || store?.preferredTaskBoardId || '').trim();
  return boardId ? `${workspaceKey}:tasks:${boardId}` : `${workspaceKey}:tasks`;
}

function scheduleTowerPgTaskBoardRefresh(store, state) {
  if (!isTowerPgBackendMode()) return;
  if (store?.navSection !== 'tasks') return;
  if (!store?.currentWorkspace?.pgBackendMode) return;
  if (!store?.session?.npub) return;
  if (!store?.backendUrl) return;
  if (typeof store?.refreshTasks !== 'function') return;
  const workspaceKey = String(store.currentWorkspaceKey || store.currentWorkspace?.workspaceKey || '').trim();
  if (!workspaceKey || !isWorkspaceDbOpenForKey(workspaceKey)) return;
  if (state.pgHydratingWorkspaceKeys.has(workspaceKey)) return;

  const refreshKey = buildTowerPgTaskBoardRefreshKey(store);
  if (!refreshKey || state.pgRefreshingTaskBoardKeys.has(refreshKey)) return;
  const lastRefreshAt = Number(state.pgTaskBoardRefreshAt.get(refreshKey) || 0);
  if (Date.now() - lastRefreshAt < PG_TASK_BOARD_REFRESH_MIN_MS) return;

  state.pgRefreshingTaskBoardKeys.add(refreshKey);
  state.pgTaskBoardRefreshAt.set(refreshKey, Date.now());
  Promise.resolve()
    .then(async () => {
      if (String(store.currentWorkspaceKey || '') !== workspaceKey) return;
      await store.refreshTasks();
    })
    .catch((error) => {
      flightDeckLog('debug', 'pg', 'Tower PG task board refresh failed after route activation', {
        workspaceKey,
        boardId: String(store?.selectedBoardId || ''),
        error: error?.message || String(error),
      });
    })
    .finally(() => {
      state.pgRefreshingTaskBoardKeys.delete(refreshKey);
    });
}

function buildSharedSpecs() {
  return [
    {
      key: 'address-book',
      query: () => getAddressBookPeople(),
      onNext: (people) => this.applyAddressBookPeople(people),
    },
  ];
}

function buildWorkspaceSpecs(store) {
  const ownerNpub = String(store?.workspaceOwnerNpub || '').trim();
  if (!ownerNpub) return [];

  const alwaysOn = [
    {
      key: 'ws:scopes',
      query: () => getScopesByOwner(ownerNpub),
      onNext: (scopes) => store.applyScopes(scopes),
    },
    {
      key: 'ws:channels',
      query: () => getChannelsByOwner(ownerNpub),
      onNext: (channels) => store.applyChannels(channels),
    },
  ];

  let sectionSpecs;
  switch (store?.navSection) {
    case 'status':
      sectionSpecs = [
        {
          key: 'status:messages',
          query: () => getMessagesByOwner(ownerNpub),
          onNext: (messages) => store.applyFileMessages(messages),
        },
        {
          key: 'status:comments',
          query: () => getCommentsByOwner(ownerNpub),
          onNext: (comments) => store.applyFileComments(comments),
        },
        {
          key: 'status:directories',
          query: () => getDirectoriesByOwner(ownerNpub),
          onNext: (directories) => store.applyDirectories(directories),
        },
        {
          key: 'status:documents',
          query: () => getDocumentsByOwner(ownerNpub),
          onNext: (documents) => store.applyDocuments(documents),
        },
        {
          key: 'status:tasks',
          query: () => getTasksByOwner(ownerNpub),
          onNext: (tasks) => store.applyTasks(tasks),
        },
      ];
      break;
    case 'chat':
      sectionSpecs = [
        {
          key: 'chat:audio-notes',
          query: () => getAudioNotesByOwner(ownerNpub),
          onNext: (audioNotes) => store.applyAudioNotes(audioNotes),
        },
      ];
      break;
    case 'files':
      sectionSpecs = [
        {
          key: 'files:messages',
          query: () => getMessagesByOwner(ownerNpub),
          onNext: (messages) => store.applyFileMessages(messages),
        },
        {
          key: 'files:comments',
          query: () => getCommentsByOwner(ownerNpub),
          onNext: (comments) => store.applyFileComments(comments),
        },
        {
          key: 'files:audio-notes',
          query: () => getAudioNotesByOwner(ownerNpub),
          onNext: (audioNotes) => store.applyAudioNotes(audioNotes),
        },
        {
          key: 'files:directories',
          query: () => getDirectoriesByOwner(ownerNpub),
          onNext: (directories) => store.applyDirectories(directories),
        },
        {
          key: 'files:documents',
          query: () => getDocumentsByOwner(ownerNpub),
          onNext: (documents) => store.applyDocuments(documents),
        },
        {
          key: 'files:tasks',
          query: () => getTasksByOwner(ownerNpub),
          onNext: (tasks) => store.applyTasks(tasks),
        },
      ];
      break;
    case 'docs':
      sectionSpecs = [
        {
          key: 'docs:directories',
          query: () => getDirectoriesByOwner(ownerNpub),
          onNext: (directories) => store.applyDirectories(directories),
        },
        {
          key: 'docs:documents',
          query: () => getWindowedDocumentsByOwner(ownerNpub),
          onNext: (documents) => store.applyDocuments(documents),
        },
      ];
      break;
    case 'tasks':
      sectionSpecs = [
        {
          key: 'tasks:tasks',
          query: () => getTasksByOwner(ownerNpub),
          onNext: (tasks) => store.applyTasks(tasks),
        },
        {
          key: 'tasks:documents',
          query: () => getWindowedDocumentsByOwner(ownerNpub),
          onNext: (documents) => store.applyDocuments(documents),
        },
      ];
      break;
    case 'settings':
      sectionSpecs = [];
      break;
    default:
      sectionSpecs = [];
  }

  if (store?.navSection === 'status' && !isFlightDeckSurfaceDisabled('reports')) {
    sectionSpecs.push({
      key: 'status:reports',
      query: () => getWindowedReportsByOwner(ownerNpub),
      onNext: (reports) => store.applyReports(reports),
    });
  }
  if (store?.navSection === 'status' && !isFlightDeckSurfaceDisabled('schedules')) {
    sectionSpecs.push({
      key: 'status:schedules',
      query: () => getSchedulesByOwner(ownerNpub),
      onNext: (schedules) => store.applySchedules(schedules),
    });
  }
  return [...alwaysOn, ...sectionSpecs];
}

function buildDetailSpecs(store) {
  const ownerNpub = String(store?.workspaceOwnerNpub || '').trim();
  if (!ownerNpub) return [];

  switch (store?.navSection) {
    case 'chat': {
      const channelId = String(store?.selectedChannelId || '').trim();
      if (!channelId) {
        const channelIds = (Array.isArray(store?.pgContextChannels) ? store.pgContextChannels : [])
          .map((channel) => String(channel?.record_id || '').trim())
          .filter(Boolean);
        if (channelIds.length === 0) return [];
        const signature = channelIds.join(',');
        return [
          {
            key: `chat:messages:scope-home:${signature}`,
            query: () => getMessagesByChannels(channelIds, {
              limit: store?.mainFeedVisibleCount || store?.MAIN_FEED_PAGE_SIZE,
            }),
            onNext: (messages) => {
              if (store.workspaceOwnerNpub !== ownerNpub || store.selectedChannelId) return;
              return store.applyMessages(messages);
            },
          },
          {
            key: `chat:reactions:scope-home:${signature}`,
            query: async () => {
              const messages = await getMessagesByChannels(channelIds, {
                limit: store?.mainFeedVisibleCount || store?.MAIN_FEED_PAGE_SIZE,
              });
              return getReactionsByTargets(
                messages.map((message) => message.record_id).filter(Boolean),
                recordFamilyHash('chat_message'),
              );
            },
            onNext: (reactions) => {
              if (store.workspaceOwnerNpub !== ownerNpub || store.selectedChannelId) return;
              return store.applyReactions(reactions);
            },
          },
        ];
      }
      const activeThreadId = String(store?.activeThreadId || '').trim();
      const specs = [
        {
          key: `chat:messages:${channelId}`,
          query: () => getMessagesByChannel(channelId, {
            limit: store?.mainFeedVisibleCount || store?.MAIN_FEED_PAGE_SIZE,
          }),
          onNext: (messages) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.selectedChannelId !== channelId) return;
            return store.applyMessages(messages);
          },
        },
        {
          key: `chat:reactions:${channelId}`,
          query: async () => {
            const messages = await getMessagesByChannel(channelId, {
              limit: store?.mainFeedVisibleCount || store?.MAIN_FEED_PAGE_SIZE,
            });
            return getReactionsByTargets(
              messages.map((message) => message.record_id).filter(Boolean),
              recordFamilyHash('chat_message'),
            );
          },
          onNext: (reactions) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.selectedChannelId !== channelId) return;
            return store.applyReactions(reactions);
          },
        },
        {
          key: `chat:channel-response-activities:${channelId}`,
          query: () => getResponseActivitiesForChannel(channelId),
          onNext: (activities) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.selectedChannelId !== channelId) return;
            return store.applyChannelResponseActivities?.(activities);
          },
        },
      ];
      if (activeThreadId) {
        const activeActivityThreadId = resolvePgThreadId(store, activeThreadId) || activeThreadId;
        specs.push({
          key: `chat:response-activities:${activeActivityThreadId}`,
          query: () => getResponseActivitiesForTarget('chat_thread', activeActivityThreadId),
          onNext: (activities) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.selectedChannelId !== channelId || store.activeThreadId !== activeThreadId) return;
            return store.applyThreadResponseActivities(activities);
          },
        });
      } else if (typeof store.applyThreadResponseActivities === 'function') {
        store.applyThreadResponseActivities([]);
      }
      return specs;
    }
    case 'tasks': {
      const taskId = String(store?.activeTaskId || '').trim();
      if (!taskId) return [];
      return [
        {
          key: `tasks:selected-task:${taskId}`,
          query: () => getTaskById(taskId),
          onNext: (task) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.activeTaskId !== taskId) return;
            return store.applySelectedTask(task);
          },
        },
        {
          key: `tasks:comments:${taskId}`,
          query: () => getCommentsByTarget(taskId),
          onNext: (comments) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.activeTaskId !== taskId) return;
            return store.applyTaskComments(comments);
          },
        },
        {
          key: `tasks:comment-reactions:${taskId}`,
          query: async () => {
            const comments = await getCommentsByTarget(taskId);
            return getReactionsByTargets(
              comments.map((comment) => comment.record_id).filter(Boolean),
              recordFamilyHash('comment'),
            );
          },
          onNext: (reactions) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.activeTaskId !== taskId) return;
            return store.applyReactions(reactions);
          },
        },
      ];
    }
    case 'docs': {
      if (store?.selectedDocType !== 'document') return [];
      const docId = String(store?.selectedDocId || '').trim();
      if (!docId) return [];
      const documentFamilyHash = recordFamilyHash('document');
      return [
        {
          key: `docs:selected-doc:${docId}`,
          query: () => getDocumentById(docId),
          onNext: (document) => {
            if (
              store.workspaceOwnerNpub !== ownerNpub
              || store.selectedDocType !== 'document'
              || store.selectedDocId !== docId
            ) return;
            return store.applySelectedDocument(document);
          },
        },
        {
          key: `docs:comments:${docId}`,
          query: () => getCommentsByTarget(docId),
          onNext: (comments) => {
            if (
              store.workspaceOwnerNpub !== ownerNpub
              || store.selectedDocType !== 'document'
              || store.selectedDocId !== docId
            ) return;
            return store.applyDocComments(
              comments.filter((comment) => comment.target_record_family_hash === documentFamilyHash),
              { docId, allowBackfill: true },
            );
          },
        },
        {
          key: `docs:comment-reactions:${docId}`,
          query: async () => {
            const comments = await getCommentsByTarget(docId);
            return getReactionsByTargets(
              comments
                .filter((comment) => comment.target_record_family_hash === documentFamilyHash)
                .map((comment) => comment.record_id)
                .filter(Boolean),
              recordFamilyHash('comment'),
            );
          },
          onNext: (reactions) => {
            if (
              store.workspaceOwnerNpub !== ownerNpub
              || store.selectedDocType !== 'document'
              || store.selectedDocId !== docId
            ) return;
            return store.applyReactions(reactions);
          },
        },
      ];
    }
    case 'reports': {
      if (isFlightDeckSurfaceDisabled('reports')) return [];
      const reportId = String(store?.selectedReportId || '').trim();
      if (!reportId) return [];
      return [
        {
          key: `reports:selected-report:${reportId}`,
          query: () => getReportById(reportId),
          onNext: (report) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.selectedReportId !== reportId) return;
            return store.applySelectedReport(report);
          },
        },
      ];
    }
    default:
      return [];
  }
}

function syncLiveQuerySet(store, bucket, specs) {
  const desiredSpecs = Array.isArray(specs) ? specs : [];
  syncBucket(store, bucket, desiredSpecs);
}

export function getSectionLiveQueryPlan(store) {
  return {
    shared: buildSharedSpecs.call(store).map((spec) => spec.key),
    workspace: buildWorkspaceSpecs(store).map((spec) => spec.key),
    detail: buildDetailSpecs(store).map((spec) => spec.key),
  };
}

export const sectionLiveQueryMixin = {
  startSharedLiveQueries() {
    const state = getSectionState(this);
    syncLiveQuerySet(this, state.shared, buildSharedSpecs.call(this));
  },

  stopSharedLiveQueries() {
    const state = getSectionState(this);
    stopBucket(this, state.shared);
  },

  startWorkspaceLiveQueries() {
    const state = getSectionState(this);
    if (typeof this.startSharedLiveQueries === 'function') {
      this.startSharedLiveQueries();
    }

    const ownerNpub = String(this.workspaceOwnerNpub || '').trim();
    const workspaceKey = String(this.currentWorkspaceKey || '').trim();
    if (state.workspaceKey !== workspaceKey || state.workspaceOwnerNpub !== ownerNpub) {
      state.workspaceKey = workspaceKey;
      state.workspaceOwnerNpub = ownerNpub;
      this.hasBootstrappedUnreadTracking = false;
    }

    if (!ownerNpub) {
      stopBucket(this, state.workspace);
      stopBucket(this, state.detail);
      return;
    }
    if (!isWorkspaceDbOpenForKey(workspaceKey)) {
      stopBucket(this, state.workspace);
      stopBucket(this, state.detail);
      return;
    }

    syncLiveQuerySet(this, state.workspace, buildWorkspaceSpecs(this));
    syncLiveQuerySet(this, state.detail, buildDetailSpecs(this));

    if (!this.hasBootstrappedUnreadTracking && typeof this.initUnreadTracking === 'function') {
      this.hasBootstrappedUnreadTracking = true;
      this.initUnreadTracking();
    }

    scheduleTowerPgWorkspaceHydration(this, state);
    scheduleTowerPgTaskBoardRefresh(this, state);
  },

  stopWorkspaceLiveQueries() {
    const state = getSectionState(this);
    stopBucket(this, state.workspace);
    stopBucket(this, state.detail);
  },

  stopAllLiveQueries() {
    const state = getSectionState(this);
    stopBucket(this, state.shared);
    stopBucket(this, state.workspace);
    stopBucket(this, state.detail);
    state.workspaceKey = '';
    state.workspaceOwnerNpub = '';
  },

  startSelectedChannelLiveQuery() {
    this.startWorkspaceLiveQueries();
  },

  stopSelectedChannelLiveQuery() {
    const state = getSectionState(this);
    for (const [key, subscription] of state.detail.entries()) {
      if (!key.startsWith('chat:messages:') && !key.startsWith('chat:reactions:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },

  startTaskCommentsLiveQuery() {
    this.startWorkspaceLiveQueries();
  },

  stopTaskCommentsLiveQuery() {
    const state = getSectionState(this);
    for (const [key, subscription] of state.detail.entries()) {
      if (!key.startsWith('tasks:comments:') && !key.startsWith('tasks:comment-reactions:') && !key.startsWith('tasks:selected-task:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },

  startOpportunityCommentsLiveQuery() {
    this.startWorkspaceLiveQueries();
  },

  stopOpportunityCommentsLiveQuery() {
    const state = getSectionState(this);
    for (const [key, subscription] of state.detail.entries()) {
      if (!key.startsWith('opportunities:comments:') && !key.startsWith('opportunities:selected-opportunity:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },

  startDocCommentsLiveQuery() {
    this.startWorkspaceLiveQueries();
  },

  stopDocCommentsLiveQuery() {
    const state = getSectionState(this);
    for (const [key, subscription] of state.detail.entries()) {
      if (!key.startsWith('docs:comments:') && !key.startsWith('docs:comment-reactions:') && !key.startsWith('docs:selected-doc:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },
};
