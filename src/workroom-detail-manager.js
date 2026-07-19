import {
  archiveTowerPgWorkroom,
  decideTowerPgApproval,
  getTowerPgChannelMessages,
  getTowerPgChannelThreads,
} from './api.js';
import {
  getWorkroomEvents,
  getWorkroomLinks,
  getWorkroomParticipants,
  upsertMessage,
  upsertWorkroom,
} from './db.js';
import {
  hydrateTowerPgWorkrooms,
  hydrateTowerPgWorkroom,
  mapPgMessageToLocal,
  mapPgWorkroomApprovalToLocal,
  mapPgWorkroomEventToLocal,
  mapPgWorkroomToLocal,
  resolveTowerPgWorkspaceContext,
  hydrateTowerPgWorkroomParticipants,
} from './pg-read-hydrator.js';
import { filterActiveWorkrooms, filterArchivedWorkrooms, isArchivedWorkroom, searchWorkroomRows } from './workrooms.js';

export const WORKROOM_EVENT_FILTERS = Object.freeze([
  { value: 'all', label: 'All history' },
  { value: 'actor', label: 'Actor' },
  { value: 'pr', label: 'PR' },
  { value: 'task', label: 'Task' },
  { value: 'artifact', label: 'Artifact' },
  { value: 'deploy', label: 'Deploy' },
  { value: 'decision', label: 'Decision' },
  { value: 'blocker', label: 'Blocker' },
]);

const FILTER_TERMS = Object.freeze({
  actor: ['actor', 'participant', 'assigned'],
  pr: ['pull_request', 'pull-request', 'pull request'],
  task: ['task'],
  artifact: ['artifact', 'file', 'document', 'doc', 'test'],
  deploy: ['deploy', 'preview', 'production'],
  decision: ['decision', 'approval', 'approved', 'rejected'],
  blocker: ['blocker', 'blocked', 'access'],
});

function text(value) { return String(value || '').trim(); }

const PARTICIPANT_METADATA_STATUS = Object.freeze(['missing', 'valid', 'invalid']);
const RUNBOOK_FIELDS = Object.freeze(['repoPath', 'install', 'test', 'build', 'start', 'deploy']);

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) { return Array.isArray(value) ? value : []; }

function boolField(value) { return typeof value === 'boolean'; }

export function workroomParticipantMetadataStatus(participant = {}) {
  const metadata = objectValue(participant.metadata);
  const explicit = text(metadata.metadataStatus || metadata.metadata_status || participant.metadata_status).toLowerCase();
  if (PARTICIPANT_METADATA_STATUS.includes(explicit)) return explicit;
  if (Object.keys(metadata).length === 0) return 'missing';

  const localWorkspace = objectValue(metadata.localWorkspace || metadata.local_workspace);
  const constraints = objectValue(metadata.constraints);
  const hasCapabilities = arrayValue(metadata.capabilities).length > 0;
  const hasWorkspace = text(localWorkspace.repoPath || localWorkspace.repo_path)
    && text(localWorkspace.defaultBranch || localWorkspace.default_branch)
    && boolField(localWorkspace.canRunTests ?? localWorkspace.can_run_tests);
  const hasConstraints = ['canMergeIntegration', 'canMergeProduction', 'canRestartManagedApps'].every((key) => (
    boolField(constraints[key]) || boolField(constraints[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)])
  ));
  return hasCapabilities && hasWorkspace && hasConstraints ? 'valid' : 'invalid';
}

export function workroomParticipantMetadata(participant = {}) {
  const metadata = objectValue(participant.metadata);
  const localWorkspace = objectValue(metadata.localWorkspace || metadata.local_workspace);
  const constraints = objectValue(metadata.constraints);
  return {
    capabilities: arrayValue(metadata.capabilities),
    localWorkspace: {
      repoPath: text(localWorkspace.repoPath || localWorkspace.repo_path),
      defaultBranch: text(localWorkspace.defaultBranch || localWorkspace.default_branch),
      canRunTests: localWorkspace.canRunTests ?? localWorkspace.can_run_tests,
    },
    constraints,
  };
}

function appTargetRows(value) {
  if (Array.isArray(value)) return value;
  const source = objectValue(value);
  if (Array.isArray(source.targets)) return source.targets;
  const rows = Object.entries(source)
    .filter(([, target]) => target && typeof target === 'object' && !Array.isArray(target))
    .map(([kind, target]) => ({ kind, ...target }));
  if (rows.length) return rows;
  const legacyUrl = text(source.preview_url || source.preview || source.url);
  return legacyUrl ? [{ kind: source.kind || 'preview', label: source.label || 'Preview', url: legacyUrl, runbook: source.runbook }] : [];
}

export function workroomAppTargetDetails(value) {
  return appTargetRows(value).map((target, index) => {
    const runbook = objectValue(target.runbook || target.run_book);
    const missingRunbookFields = RUNBOOK_FIELDS.filter((field) => !text(runbook[field] || runbook[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)]));
    return {
      ...target,
      id: text(target.id) || `app-target-${index}`,
      kind: text(target.kind) || 'app',
      label: text(target.label) || text(target.kind) || 'App target',
      url: text(target.url),
      branch: text(target.branch),
      runbook,
      runbookStatus: Object.keys(runbook).length === 0 ? 'missing' : (missingRunbookFields.length ? 'invalid' : 'valid'),
      missingRunbookFields,
    };
  });
}

function workroomMetadata(room) {
  return room?.metadata && typeof room.metadata === 'object' && !Array.isArray(room.metadata)
    ? room.metadata
    : {};
}

export function workroomAnnouncementMessageId(room) {
  const metadata = workroomMetadata(room);
  return text(room?.announcement_message_id || metadata.announcement_message_id);
}

export function workroomAnnouncementThreadId(room) {
  const metadata = workroomMetadata(room);
  return text(room?.announcement_thread_id || metadata.announcement_thread_id);
}

export function workroomAnnouncementChannelId(room) {
  const metadata = workroomMetadata(room);
  return text(room?.announcement_channel_id || metadata.announcement_channel_id || room?.channel_id);
}

function workroomAnnouncementMessage(messages = [], room = {}) {
  const messageId = workroomAnnouncementMessageId(room);
  const threadId = workroomAnnouncementThreadId(room);
  const roomId = text(room?.record_id);
  const rows = Array.isArray(messages) ? messages : [];
  if (messageId && !threadId) {
    const exactMessage = rows.find((message) => message?.record_id === messageId);
    if (exactMessage) return exactMessage;
  }
  if (threadId) {
    if (messageId) {
      const exactThreadedMessage = rows.find((message) =>
        message?.record_id === messageId
        && text(message?.pg_thread_id || message?.thread_id) === threadId
      );
      if (exactThreadedMessage) return exactThreadedMessage;
    }
    const exactThreadRoot = rows.find((message) => message?.pg_thread_id === threadId && !message?.parent_message_id);
    if (exactThreadRoot) return exactThreadRoot;
  }
  const taggedMessages = rows.filter((message) => {
    const metadata = message?.pg_metadata || message?.metadata || {};
    if (!roomId || metadata?.workroom_id !== roomId) return false;
    return metadata?.kind === 'workroom_announcement'
      || (threadId && metadata?.workroom_thread_id === threadId);
  });
  if (threadId) {
    return taggedMessages.find((message) => message?.pg_thread_id === threadId && !message?.parent_message_id) || null;
  }
  if (messageId) return null;
  return taggedMessages.find((message) => message?.pg_thread_id && !message?.parent_message_id)
    || taggedMessages.find((message) => !message?.parent_message_id)
    || taggedMessages[0]
    || null;
}

function matchesEventFilter(event, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'pr' && (text(event?.target_type).toLowerCase() === 'pull_request' || /^pr[-#]?\d+/i.test(text(event?.target_ref)))) return true;
  const haystack = [event?.event_type, event?.target_type, event?.target_ref, event?.title, event?.body]
    .map(text).join(' ').toLowerCase();
  return (FILTER_TERMS[filter] || []).some((term) => haystack.includes(term));
}

export function filterWorkroomEvents(events = [], { type = 'all', actor = '', pr = '', task = '', artifact = '', from = '', to = '' } = {}) {
  const actorNeedle = text(actor).toLowerCase();
  const needles = [pr, task, artifact].map((value) => text(value).toLowerCase()).filter(Boolean);
  return (Array.isArray(events) ? events : [])
    .filter((event) => matchesEventFilter(event, type))
    .filter((event) => !actorNeedle || [event?.actor_npub, event?.actor_id].map(text).join(' ').toLowerCase().includes(actorNeedle))
    .filter((event) => !needles.length || needles.every((needle) => [event?.target_ref, event?.title, event?.body, event?.payload].map(text).join(' ').toLowerCase().includes(needle)))
    .filter((event) => !from || text(event?.created_at).slice(0, 10) >= from)
    .filter((event) => !to || text(event?.created_at).slice(0, 10) <= to)
    .sort((a, b) => text(b?.created_at).localeCompare(text(a?.created_at)));
}

function mergeById(rows, incoming) {
  const map = new Map((Array.isArray(rows) ? rows : []).map((row) => [row?.record_id, row]));
  for (const row of incoming || []) if (row?.record_id) map.set(row.record_id, row);
  return [...map.values()];
}

function workroomThreadMessageReady(message, room = {}) {
  if (!message?.record_id) return false;
  const expectedThreadId = workroomAnnouncementThreadId(room);
  const messageThreadId = text(message?.pg_thread_id || message?.thread_id);
  if (!expectedThreadId) return Boolean(messageThreadId);
  return messageThreadId === expectedThreadId;
}

function approvalMetadata(approval) {
  return approval?.metadata && typeof approval.metadata === 'object' && !Array.isArray(approval.metadata)
    ? approval.metadata
    : {};
}

export function workroomApprovalDetails(approval, room = {}) {
  const metadata = approvalMetadata(approval);
  return {
    repo: metadata.repo || room.repo?.name || room.repo?.url || '',
    fromBranch: metadata.from_branch || room.branches?.integration || '',
    productionBranch: metadata.to_branch || metadata.production_branch || room.branches?.production || '',
    commit: metadata.commit || '',
    previewUrl: metadata.preview_url || room.app_targets?.preview_url || room.app_targets?.preview || '',
    integrationAutopilot: metadata.integration_autopilot_npub || room.integration_autopilot_npub || '',
    validationEvidence: metadata.validation_evidence ?? metadata.validation ?? metadata.evidence ?? '',
  };
}

export function isWorkroomApprovalApprover(room, participants = [], viewerNpub = '') {
  const viewer = text(viewerNpub);
  if (!viewer) return false;
  const policyApprovers = Array.isArray(room?.approval_policy?.human_approver_npubs)
    ? room.approval_policy.human_approver_npubs.map(text).filter(Boolean)
    : [];
  if (policyApprovers.includes(viewer)) return true;
  return participants.some((participant) => (
    text(participant?.actor_npub) === viewer
    && participant?.role === 'human_approver'
    && participant?.access_status === 'granted'
    && participant?.status !== 'removed'
  ));
}

export const workroomDetailMixin = {
  get activeWorkrooms() { return filterActiveWorkrooms(this.workrooms); },
  get archivedWorkrooms() { return filterArchivedWorkrooms(this.workrooms); },
  get visibleWorkroomRows() {
    const rows = this.workroomArchiveView ? this.archivedWorkrooms : this.activeWorkrooms;
    return searchWorkroomRows(rows, this.workroomListQuery);
  },
  get selectedWorkroom() { return this.workrooms.find((row) => row?.record_id === this.activeWorkroomId) || null; },
  get selectedWorkroomParticipants() { return this.workroomParticipants.filter((row) => row.workroom_id === this.activeWorkroomId); },
  get selectedWorkroomLinks() { return this.workroomLinks.filter((row) => row.workroom_id === this.activeWorkroomId); },
  get selectedWorkroomDocLinks() {
    return this.selectedWorkroomLinks.filter((link) => /doc|document|artifact|file/i.test(`${link?.link_type || ''} ${link?.target_type || ''}`));
  },
  get selectedWorkroomTaskLinks() {
    return this.selectedWorkroomLinks.filter((link) => /task|work.?item/i.test(`${link?.link_type || ''} ${link?.target_type || ''}`));
  },
  get selectedWorkroomApprovals() { return this.workroomApprovals.filter((row) => row.target_id === this.activeWorkroomId); },
  get selectedWorkroomPendingApprovals() {
    return this.selectedWorkroomApprovals.filter((approval) => ['requested', 'in_review'].includes(approval.status));
  },
  get canDecideSelectedWorkroomApproval() {
    return isWorkroomApprovalApprover(this.selectedWorkroom, this.selectedWorkroomParticipants, this.currentViewerNpub);
  },
  get selectedWorkroomEvents() {
    return filterWorkroomEvents(this.workroomEvents.filter((row) => row.workroom_id === this.activeWorkroomId), this.workroomEventFilters);
  },
  get selectedWorkroomBlockers() {
    return this.workroomEvents
      .filter((row) => row.workroom_id === this.activeWorkroomId)
      .filter((event) => matchesEventFilter(event, 'blocker') || event?.payload?.blocking === true)
      .sort((a, b) => text(b?.created_at).localeCompare(text(a?.created_at)));
  },
  get selectedWorkroomAccessWarnings() {
    return this.selectedWorkroomParticipants.filter((participant) => participant.access_status === 'failed' || participant.status === 'failed');
  },
  get selectedWorkroomParticipantReadiness() {
    return this.selectedWorkroomParticipants.map((participant) => ({
      ...participant,
      metadataStatus: workroomParticipantMetadataStatus(participant),
      metadataDetails: workroomParticipantMetadata(participant),
    }));
  },
  get selectedWorkroomIntegrationParticipant() {
    return this.selectedWorkroomParticipantReadiness.find((participant) => participant.role === 'integration') || null;
  },
  get selectedWorkroomMetadataWarnings() {
    const warnings = [];
    const integration = this.selectedWorkroomIntegrationParticipant;
    if (!integration) warnings.push('No integration participant is assigned to this workroom.');
    else if (integration.metadataStatus === 'missing') warnings.push(`${integration.label || integration.actor_npub || 'Integration participant'} has not supplied typed self metadata.`);
    else if (integration.metadataStatus === 'invalid') warnings.push(`${integration.label || integration.actor_npub || 'Integration participant'} has incomplete or invalid typed self metadata.`);
    const targets = this.selectedWorkroomAppTargets;
    if (targets.length === 0) warnings.push('No app targets are configured for this workroom.');
    targets.forEach((target) => {
      if (target.runbookStatus === 'missing') warnings.push(`${target.label} has no runbook data.`);
      else if (target.runbookStatus === 'invalid') warnings.push(`${target.label} runbook is incomplete: ${target.missingRunbookFields.join(', ')}.`);
    });
    return warnings;
  },
  get selectedWorkroomAppTargets() { return workroomAppTargetDetails(this.selectedWorkroom?.app_targets); },
  get selectedWorkroomAnnouncementMessageId() {
    return workroomAnnouncementMessageId(this.selectedWorkroom)
      || workroomAnnouncementMessage(this.messages, this.selectedWorkroom)?.record_id
      || '';
  },
  get selectedWorkroomAnnouncementThreadId() {
    return workroomAnnouncementThreadId(this.selectedWorkroom);
  },
  get selectedWorkroomAnnouncementChannelId() {
    return workroomAnnouncementChannelId(this.selectedWorkroom);
  },
  get selectedWorkroomAnnouncementMessage() {
    return workroomAnnouncementMessage(this.messages, this.selectedWorkroom);
  },
  get selectedWorkroomThreadReplies() {
    const parent = this.selectedWorkroomAnnouncementMessage;
    if (!parent?.record_id || typeof this.getThreadReplies !== 'function') return [];
    return this.getThreadReplies(parent.record_id);
  },
  get selectedWorkroomThreadMessages() {
    const parent = this.selectedWorkroomAnnouncementMessage;
    if (!parent?.record_id) return [];
    const replies = this.activeThreadId === parent.record_id && Array.isArray(this.visibleThreadMessages)
      ? this.visibleThreadMessages
      : this.selectedWorkroomThreadReplies;
    return [parent, ...replies];
  },
  get selectedWorkroomRoomDetails() {
    const room = this.selectedWorkroom || {};
    return {
      repo: room.repo || {},
      branches: room.branches || {},
      appTargets: room.app_targets || {},
      approvalPolicy: room.approval_policy || {},
      archivePolicy: room.archive_policy || {},
      metadata: room.metadata || {},
      announcement: {
        messageId: workroomAnnouncementMessageId(room),
        threadId: workroomAnnouncementThreadId(room),
        channelId: workroomAnnouncementChannelId(room),
      },
    };
  },
  openWorkroomRoomDetails() { this.workroomRoomDetailsOpen = true; },
  closeWorkroomRoomDetails() { this.workroomRoomDetailsOpen = false; },
  async refreshWorkroomParticipantMetadata(participant) {
    const room = this.selectedWorkroom;
    const context = resolveTowerPgWorkspaceContext(this);
    if (!room?.record_id || !participant?.record_id || !context.workspaceId || !context.baseUrl) {
      this.workroomDetailNotice = 'Participant self-metadata refresh is unavailable: no Tower participant integration is configured.';
      return [];
    }
    if (this.workroomParticipantRefreshingId) return [];
    this.workroomParticipantRefreshingId = participant.record_id;
    this.workroomError = '';
    try {
      const rows = await hydrateTowerPgWorkroomParticipants(this, room.record_id);
      this.workroomDetailNotice = 'Participant metadata refreshed from Tower.';
      return rows;
    } catch (error) {
      this.workroomError = error?.message || 'Could not refresh participant metadata from Tower.';
      return [];
    } finally {
      this.workroomParticipantRefreshingId = '';
    }
  },
  isWorkroomArchived(room) { return isArchivedWorkroom(room); },
  canArchiveWorkroom(room) {
    return Boolean(room?.record_id) && !isArchivedWorkroom(room);
  },
  applyWorkrooms(rows = []) { this.workrooms = mergeById(this.workrooms, rows); },
  applyWorkroomParticipants(rows = []) { this.workroomParticipants = mergeById(this.workroomParticipants, rows); },
  applyWorkroomEvents(rows = []) { this.workroomEvents = mergeById(this.workroomEvents, rows); },
  applyWorkroomLinks(rows = []) { this.workroomLinks = mergeById(this.workroomLinks, rows); },
  applyWorkroomApprovals(rows = []) { this.workroomApprovals = mergeById(this.workroomApprovals, rows); },

  async refreshWorkrooms(options = {}) {
    if (!this.isTowerPgMode) return [];
    if (this.workroomRefreshInFlight) return this.workroomRefreshInFlight;

    const run = async () => {
      try {
        const rows = await hydrateTowerPgWorkrooms(this, options);
        this.workroomError = '';
        return rows;
      } catch (error) {
        // Workrooms are an enhancement to the status page. Do not surface a
        // signer/fetch implementation error as a blocking page-level failure.
        this.workroomError = 'Workrooms are temporarily unavailable.';
        return [];
      } finally {
        this.workroomRefreshInFlight = null;
      }
    };

    const delay = options.immediate ? 0 : Math.max(0, Number(options.debounceMs ?? 150));
    this.workroomRefreshInFlight = new Promise((resolve) => {
      const start = () => run().then(resolve);
      if (delay === 0) start();
      else this.workroomRefreshTimer = setTimeout(() => {
        this.workroomRefreshTimer = null;
        start();
      }, delay);
    });
    return this.workroomRefreshInFlight;
  },

  async openWorkroomDetail(workroomId, options = {}) {
    const id = text(workroomId);
    if (!id) return;
    const hasCachedRoom = this.workrooms.some((row) => row?.record_id === id);
    this.activeWorkroomId = id;
    if (options.switchView !== false) this.navSection = 'workroom';
    this.workroomDetailOpen = true;
    this.workroomDetailLoading = !hasCachedRoom;
    this.workroomError = '';
    try {
      const hydrated = hasCachedRoom && options.refreshRoom !== true
        ? this.selectedWorkroom
        : await hydrateTowerPgWorkroom(this, id);
      if (hydrated) this.applyWorkrooms([hydrated]);
      this.workroomDetailNotice = '';
      await this.hydrateSelectedWorkroomThread();
      if (options.openThread !== false) await this.openSelectedWorkroomThread({ syncRoute: false, refreshMessages: false });
      if (typeof this.syncRoute === 'function' && options.syncRoute !== false) this.syncRoute();
    } catch (error) {
      this.workroomError = error?.message || 'Could not load workroom history.';
    } finally {
      this.workroomDetailLoading = false;
    }
  },

  closeWorkroomDetail(options = {}) {
    if (this.workroomDetailLoading) return;
    this.workroomDetailOpen = false;
    this.workroomRoomDetailsOpen = false;
    this.activeWorkroomId = '';
    this.workroomError = '';
    if (this.navSection === 'workroom' && options.switchView !== false) this.navSection = 'status';
    if (typeof this.syncRoute === 'function' && options.syncRoute !== false) this.syncRoute();
  },

  async openSelectedWorkroomThread(options = {}) {
    const room = this.selectedWorkroom;
    const channelId = workroomAnnouncementChannelId(room);
    const messageId = workroomAnnouncementMessageId(room);
    const threadId = workroomAnnouncementThreadId(room);
    let existingMessage = workroomAnnouncementMessage(this.messages, room);
    if (!room?.record_id || !channelId || (!messageId && !threadId && !existingMessage)) {
      this.workroomDetailNotice = 'This workroom does not have a chat thread yet.';
      return null;
    }
    if (this.selectedChannelId !== channelId) {
      if (typeof this.selectPgChannelContext === 'function') this.selectPgChannelContext(channelId);
      else if (typeof this.selectChannel === 'function') await this.selectChannel(channelId, { syncRoute: false, scrollToLatest: false });
    }
    if (options.refreshMessages !== false && typeof this.refreshMessages === 'function') {
      await this.refreshMessages({ scrollToLatest: false, scrollThreadToLatest: true }).catch(() => undefined);
    }
    let candidateMessage = this.selectedWorkroomAnnouncementMessage || existingMessage || (this.messages || []).find((row) => row?.record_id === messageId);
    if (!workroomThreadMessageReady(candidateMessage, room)) {
      await this.hydrateSelectedWorkroomThread();
      existingMessage = workroomAnnouncementMessage(this.messages, room);
      candidateMessage = this.selectedWorkroomAnnouncementMessage || existingMessage || (this.messages || []).find((row) => row?.record_id === messageId);
    }
    if (!workroomThreadMessageReady(candidateMessage, room)) {
      this.workroomDetailNotice = 'The workroom chat message is still loading.';
      return null;
    }
    const message = candidateMessage;
    this.workroomDetailNotice = '';
    if (typeof this.openThread === 'function') this.openThread(message.record_id, {
      scrollToLatest: true,
      syncRoute: options.syncRoute !== false,
      preserveComposer: options.preserveComposer === true,
    });
    return message;
  },

  async hydrateSelectedWorkroomThread() {
    const room = this.selectedWorkroom;
    const context = resolveTowerPgWorkspaceContext(this);
    const channelId = workroomAnnouncementChannelId(room);
    const threadId = workroomAnnouncementThreadId(room);
    if (!room?.record_id || !channelId || !threadId || !context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) return [];

    const readThreads = this.getTowerPgChannelThreads || getTowerPgChannelThreads;
    const readMessages = this.getTowerPgChannelMessages || getTowerPgChannelMessages;
    const persistMessage = this.upsertMessage || upsertMessage;
    const messageId = workroomAnnouncementMessageId(room);
    const threadResult = messageId ? null : await readThreads(context.workspaceId, channelId, {
        baseUrl: context.baseUrl,
        appNpub: context.appNpub,
        includeArchived: true,
        limit: 100,
      });
    const rawThreads = messageId
      ? [{ id: threadId, source_message_id: messageId, channel_id: channelId }]
      : (Array.isArray(threadResult?.threads) ? threadResult.threads : []);
    const threadById = new Map(rawThreads.map((thread) => [text(thread?.id), thread]).filter(([id]) => id));
    const messagesResult = await readMessages(context.workspaceId, channelId, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
      threadId,
      limit: 200,
    });
    const rows = (Array.isArray(messagesResult?.messages) ? messagesResult.messages : [])
      .map((message) => mapPgMessageToLocal(message, {
        workspaceOwnerNpub: context.workspaceOwnerNpub,
        senderNpub: '',
        threadById,
      }))
      .filter((message) => message.record_id && message.channel_id);
    for (const row of rows) {
      await persistMessage(row);
      if (typeof this.patchMessageLocal === 'function') this.patchMessageLocal(row);
      else this.messages = mergeById(this.messages || [], [row]);
    }
    return rows;
  },

  async sendSelectedWorkroomThreadReply() {
    const parent = await this.openSelectedWorkroomThread({ syncRoute: false, refreshMessages: false, preserveComposer: true });
    if (!parent) return;
    if (typeof this.sendThreadReply === 'function') await this.sendThreadReply();
  },

  async archiveSelectedWorkroom() {
    return this.archiveWorkroom(this.selectedWorkroom);
  },

  async archiveWorkroom(room) {
    const context = resolveTowerPgWorkspaceContext(this);
    if (!room?.record_id || !context.workspaceId || !context.baseUrl) return;
    if (this.workroomArchivingId) return;
    this.workroomArchivingId = room.record_id;
    if (this.activeWorkroomId === room.record_id) this.workroomDetailLoading = true;
    this.workroomError = '';
    try {
      const archiveRequest = this.archiveTowerPgWorkroom || archiveTowerPgWorkroom;
      const result = await archiveRequest(context.workspaceId, room.record_id, { row_version: room.row_version || 1 }, context);
      const archived = mapPgWorkroomToLocal(result?.workroom || result);
      if (archived.record_id) {
        const persistWorkroom = this.upsertWorkroom || upsertWorkroom;
        await persistWorkroom(archived);
        this.applyWorkrooms([archived]);
      }
      this.workroomDetailNotice = 'Workroom archived.';
      this.workroomArchiveView = true;
    } catch (error) {
      this.workroomError = error?.message || 'Could not archive workroom.';
    } finally {
      this.workroomArchivingId = '';
      if (this.activeWorkroomId === room.record_id) this.workroomDetailLoading = false;
    }
  },

  workroomApprovalDetails(approval) {
    return workroomApprovalDetails(approval, this.selectedWorkroom || {});
  },

  workroomApprovalEvidence(approval) {
    const evidence = this.workroomApprovalDetails(approval).validationEvidence;
    if (typeof evidence === 'string') return evidence;
    if (Array.isArray(evidence)) return evidence.join(' · ');
    if (evidence && typeof evidence === 'object') return Object.entries(evidence).map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · ');
    return 'Not recorded';
  },

  async decideWorkroomApproval(approval, status) {
    if (!approval?.record_id || !this.canDecideSelectedWorkroomApproval) {
      this.workroomError = 'Only an assigned human approver can decide this production merge.';
      return;
    }
    if (!['approved', 'rejected'].includes(status)) return;
    const context = resolveTowerPgWorkspaceContext(this);
    if (!context.workspaceId || !context.baseUrl) return;
    this.workroomApprovalSubmittingId = approval.record_id;
    this.workroomError = '';
    try {
      const result = await decideTowerPgApproval(context.workspaceId, approval.record_id, {
        status,
        row_version: approval.row_version || approval.version || 1,
        decision_note: String(this.workroomApprovalDecisionNote || '').trim() || null,
      }, context);
      const decided = mapPgWorkroomApprovalToLocal(result?.approval || result);
      if (decided.record_id) this.applyWorkroomApprovals([decided]);
      const event = mapPgWorkroomEventToLocal(result?.event);
      if (event.record_id) this.applyWorkroomEvents([event]);
      this.workroomApprovalDecisionNote = '';
      await hydrateTowerPgWorkroom(this, this.activeWorkroomId);
      this.workroomDetailNotice = status === 'approved' ? 'Production merge approved.' : 'Production merge rejected.';
    } catch (error) {
      this.workroomError = error?.status === 403
        ? 'Tower rejected this decision: you are not an allowed human approver.'
        : error?.message || 'Could not record the production merge decision.';
    } finally {
      this.workroomApprovalSubmittingId = '';
    }
  },

  async loadWorkroomRowsForPalette() {
    const refreshed = await this.refreshWorkrooms();
    const rows = refreshed.length > 0 ? refreshed : this.workrooms;
    const enriched = await Promise.all(rows.map(async (room) => {
      const [participants, events, links] = await Promise.all([
        getWorkroomParticipants(room.record_id), getWorkroomEvents(room.record_id), getWorkroomLinks(room.record_id),
      ]);
      return { room, participants, events, links };
    }));
    return enriched;
  },
};

export function createWorkroomDetailState() {
  return {
    workrooms: [],
    workroomParticipants: [],
    workroomEvents: [],
    workroomLinks: [],
    workroomApprovals: [],
    workroomArchiveView: false,
    workroomListQuery: '',
    workroomDetailOpen: false,
    activeWorkroomId: '',
    workroomDetailLoading: false,
    workroomError: '',
    workroomRefreshInFlight: null,
    workroomRefreshTimer: null,
    workroomDetailNotice: '',
    workroomRoomDetailsOpen: false,
    workroomParticipantRefreshingId: '',
    workroomArchivingId: '',
    workroomApprovalDecisionNote: '',
    workroomApprovalSubmittingId: '',
    workroomEventFilterOptions: WORKROOM_EVENT_FILTERS,
    workroomEventFilters: { type: 'all', actor: '', pr: '', task: '', artifact: '', from: '', to: '' },
    workroomRoleOptions: [],
  };
}
