import {
  archiveTowerPgWorkroom,
  decideTowerPgApproval,
} from './api.js';
import {
  getWorkroomEvents,
  getWorkroomLinks,
  getWorkroomParticipants,
  upsertWorkroom,
} from './db.js';
import {
  hydrateTowerPgWorkrooms,
  hydrateTowerPgWorkroom,
  mapPgWorkroomApprovalToLocal,
  mapPgWorkroomEventToLocal,
  mapPgWorkroomToLocal,
  resolveTowerPgWorkspaceContext,
} from './pg-read-hydrator.js';
import { filterActiveWorkrooms, filterArchivedWorkrooms, searchWorkroomRows } from './workrooms.js';

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
  applyWorkrooms(rows = []) { this.workrooms = mergeById(this.workrooms, rows); },
  applyWorkroomParticipants(rows = []) { this.workroomParticipants = mergeById(this.workroomParticipants, rows); },
  applyWorkroomEvents(rows = []) { this.workroomEvents = mergeById(this.workroomEvents, rows); },
  applyWorkroomLinks(rows = []) { this.workroomLinks = mergeById(this.workroomLinks, rows); },
  applyWorkroomApprovals(rows = []) { this.workroomApprovals = mergeById(this.workroomApprovals, rows); },

  async refreshWorkrooms(options = {}) {
    if (!this.isTowerPgMode) return [];
    try {
      const rows = await hydrateTowerPgWorkrooms(this, options);
      return rows;
    } catch (error) {
      this.workroomError = error?.message || 'Could not load workrooms.';
      return [];
    }
  },

  async openWorkroomDetail(workroomId) {
    const id = text(workroomId);
    if (!id) return;
    this.activeWorkroomId = id;
    this.workroomDetailOpen = true;
    this.workroomDetailLoading = true;
    this.workroomError = '';
    try {
      const hydrated = await hydrateTowerPgWorkroom(this, id);
      if (hydrated) this.applyWorkrooms([hydrated]);
      this.workroomDetailNotice = '';
    } catch (error) {
      this.workroomError = error?.message || 'Could not load workroom history.';
    } finally {
      this.workroomDetailLoading = false;
    }
  },

  closeWorkroomDetail() {
    if (this.workroomDetailLoading) return;
    this.workroomDetailOpen = false;
    this.activeWorkroomId = '';
    this.workroomError = '';
  },

  async archiveSelectedWorkroom() {
    const room = this.selectedWorkroom;
    const context = resolveTowerPgWorkspaceContext(this);
    if (!room?.record_id || !context.workspaceId || !context.baseUrl) return;
    this.workroomDetailLoading = true;
    try {
      const result = await archiveTowerPgWorkroom(context.workspaceId, room.record_id, { row_version: room.row_version || 1 }, context);
      const archived = mapPgWorkroomToLocal(result?.workroom || result);
      if (archived.record_id) {
        await upsertWorkroom(archived);
        this.applyWorkrooms([archived]);
      }
      this.workroomDetailNotice = 'Workroom archived.';
      this.workroomArchiveView = true;
    } catch (error) {
      this.workroomError = error?.message || 'Could not archive workroom.';
    } finally {
      this.workroomDetailLoading = false;
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
    workroomDetailNotice: '',
    workroomApprovalDecisionNote: '',
    workroomApprovalSubmittingId: '',
    workroomEventFilterOptions: WORKROOM_EVENT_FILTERS,
    workroomEventFilters: { type: 'all', actor: '', pr: '', task: '', artifact: '', from: '', to: '' },
    workroomRoleOptions: [],
  };
}
