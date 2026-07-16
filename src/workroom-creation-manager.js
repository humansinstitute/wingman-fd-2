import {
  createTowerPgWorkroom,
  startTowerPgWorkroom,
  updateTowerPgChannel,
} from './api.js';
import {
  mapPgChannelToLocal,
  mapPgWorkroomToLocal,
  resolveTowerPgWorkspaceContext,
} from './pg-read-hydrator.js';
import {
  replaceWorkroomParticipantsForRoom,
  upsertChannel,
  upsertWorkroom,
} from './db.js';

export const WORKROOM_DEFAULTS_KEY = 'workroom_defaults';
export const WORKROOM_ROLE_OPTIONS = Object.freeze([
  { value: 'integration', label: 'Integration' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'human_approver', label: 'Human approver' },
  { value: 'observer', label: 'Observer' },
]);

export function createWorkroomForm(overrides = {}) {
  return {
    title: '',
    goal: '',
    participants: [{ actor_npub: '', role: 'contributor', label: '' }],
    integration_autopilot_npub: '',
    repo_url: '',
    repo_name: '',
    integration_branch: '',
    production_branch: 'main',
    preview_app_target: '',
    production_app_target: '',
    approval_policy: 'human_required',
    save_choices_as_channel_defaults: false,
    ...overrides,
  };
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function workroomDefaultsFromChannel(channel) {
  const metadata = objectOrEmpty(channel?.metadata);
  const defaults = objectOrEmpty(metadata[WORKROOM_DEFAULTS_KEY]);
  return createWorkroomForm({
    ...defaults,
    participants: Array.isArray(defaults.participants) && defaults.participants.length > 0
      ? defaults.participants.map((participant) => ({
        actor_npub: String(participant?.actor_npub || '').trim(),
        role: String(participant?.role || 'contributor').trim() || 'contributor',
        label: String(participant?.label || '').trim(),
      }))
      : [{ actor_npub: '', role: 'contributor', label: '' }],
    save_choices_as_channel_defaults: false,
  });
}

export function mergeWorkroomFormWithChannelDefaults(channel, overrides = {}) {
  return createWorkroomForm({ ...workroomDefaultsFromChannel(channel), ...overrides });
}

export function buildWorkroomCreatePayload(form, { scopeId, channelId } = {}) {
  const participants = (Array.isArray(form?.participants) ? form.participants : [])
    .map((participant) => ({
      actor_npub: String(participant?.actor_npub || '').trim(),
      kind: participant?.kind || 'human',
      role: participant?.role || 'contributor',
      label: String(participant?.label || '').trim() || null,
    }))
    .filter((participant) => participant.actor_npub);
  return {
    scope_id: scopeId || null,
    channel_id: channelId || null,
    title: String(form?.title || '').trim(),
    goal: String(form?.goal || '').trim(),
    integration_autopilot_npub: String(form?.integration_autopilot_npub || '').trim() || null,
    repo: {
      url: String(form?.repo_url || '').trim() || null,
      name: String(form?.repo_name || '').trim() || null,
    },
    branches: {
      integration: String(form?.integration_branch || '').trim() || null,
      production: String(form?.production_branch || '').trim() || null,
    },
    app_targets: {
      preview: String(form?.preview_app_target || '').trim() || null,
      production: String(form?.production_app_target || '').trim() || null,
    },
    approval_policy: {
      mode: String(form?.approval_policy || 'human_required').trim(),
    },
    participants,
  };
}

export function failedWorkroomParticipants(participants = []) {
  return (Array.isArray(participants) ? participants : [])
    .filter((participant) => participant?.access_status === 'failed');
}

function channelWithDefaults(channel, defaults) {
  return {
    ...channel,
    metadata: {
      ...objectOrEmpty(channel?.metadata),
      [WORKROOM_DEFAULTS_KEY]: {
        ...defaults,
        save_choices_as_channel_defaults: undefined,
      },
    },
  };
}

export function workroomAnnouncementLink(announcement, baseUrl = '') {
  const link = String(announcement?.metadata?.workroom_link || '').trim();
  if (!link) return '';
  if (/^https?:\/\//i.test(link)) return link;
  return `${String(baseUrl || '').replace(/\/$/, '')}${link}`;
}

export const workroomCreationMixin = {
  get workroomRoleOptions() {
    return WORKROOM_ROLE_OPTIONS;
  },

  get workroomCreationAnnouncementHref() {
    const context = resolveTowerPgWorkspaceContext(this);
    return workroomAnnouncementLink(this.workroomCreationAnnouncement, context.baseUrl);
  },
  openWorkroomCreation() {
    const channel = this.selectedChannel;
    if (!channel?.record_id) {
      this.error = 'Select a channel before creating a workroom.';
      return;
    }
    this.workroomCreationForm = mergeWorkroomFormWithChannelDefaults(channel);
    this.workroomCreationError = '';
    this.workroomCreationNotice = '';
    this.workroomCreationFailedParticipants = [];
    this.workroomCreationAnnouncement = null;
    this.workroomCreationOpen = true;
  },

  closeWorkroomCreation() {
    if (this.workroomCreationSubmitting) return;
    this.workroomCreationOpen = false;
    this.workroomCreationError = '';
  },

  addWorkroomParticipant() {
    this.workroomCreationForm.participants.push({ actor_npub: '', role: 'contributor', label: '' });
  },

  removeWorkroomParticipant(index) {
    if (this.workroomCreationForm.participants.length <= 1) return;
    this.workroomCreationForm.participants.splice(index, 1);
  },

  async createAndStartWorkroom() {
    const form = this.workroomCreationForm;
    const channel = this.selectedChannel;
    const context = resolveTowerPgWorkspaceContext(this);
    if (!channel?.record_id) return this.setWorkroomCreationError('Select a channel first.');
    if (!context.workspaceId || !context.baseUrl) return this.setWorkroomCreationError('Tower PG workspace is not connected.');
    if (!String(form.title || '').trim()) return this.setWorkroomCreationError('Add a workroom title.');
    if (!String(form.goal || '').trim()) return this.setWorkroomCreationError('Add a workroom goal.');

    this.workroomCreationSubmitting = true;
    this.workroomCreationError = '';
    this.workroomCreationNotice = '';
    try {
      const payload = buildWorkroomCreatePayload(form, { scopeId: channel.scope_id, channelId: channel.record_id });
      const created = await createTowerPgWorkroom(context.workspaceId, payload, { baseUrl: context.baseUrl, appNpub: context.appNpub });
      const localWorkroom = mapPgWorkroomToLocal(created?.workroom || created);
      if (localWorkroom.record_id) await upsertWorkroom(localWorkroom);
      if (localWorkroom.record_id && Array.isArray(created?.participants)) {
        await replaceWorkroomParticipantsForRoom(localWorkroom.record_id, created.participants.map((participant) => ({
          ...participant,
          record_id: participant.id || participant.record_id,
        })));
      }
      this.workroomCreationFailedParticipants = failedWorkroomParticipants(created?.participants);

      if (form.save_choices_as_channel_defaults) {
        const nextChannel = channelWithDefaults(channel, createWorkroomForm(form));
        const updated = await updateTowerPgChannel(context.workspaceId, channel.record_id, { metadata: nextChannel.metadata }, { baseUrl: context.baseUrl, appNpub: context.appNpub });
        const localChannel = mapPgChannelToLocal(updated?.channel || updated, { workspaceOwnerNpub: context.workspaceOwnerNpub });
        await upsertChannel(localChannel);
        this.channels = this.channels.map((candidate) => candidate.record_id === localChannel.record_id ? localChannel : candidate);
      }

      const started = await startTowerPgWorkroom(context.workspaceId, localWorkroom.record_id, {
        row_version: localWorkroom.row_version || created?.workroom?.row_version || 1,
      }, { baseUrl: context.baseUrl, appNpub: context.appNpub });
      const startedRoom = mapPgWorkroomToLocal(started?.workroom || started);
      if (startedRoom.record_id) await upsertWorkroom(startedRoom);
      this.workroomCreationAnnouncement = started?.announcement_message || null;
      this.workroomCreationNotice = 'Workroom started in this channel.';
      this.workroomCreationOpen = this.workroomCreationFailedParticipants.length > 0;
      if (typeof this.refreshMessages === 'function') await this.refreshMessages({ scrollToLatest: true });
    } catch (error) {
      this.setWorkroomCreationError(error?.message || 'Failed to create workroom.');
    } finally {
      this.workroomCreationSubmitting = false;
    }
  },

  setWorkroomCreationError(message) {
    this.workroomCreationError = String(message || 'Workroom creation failed.');
    return null;
  },
};

export function createWorkroomCreationState() {
  return {
    workroomCreationOpen: false,
    workroomCreationSubmitting: false,
    workroomCreationForm: createWorkroomForm(),
    workroomCreationError: '',
    workroomCreationNotice: '',
    workroomCreationFailedParticipants: [],
    workroomCreationAnnouncement: null,
  };
}
