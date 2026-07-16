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
    integration_branch: 'staging',
    production_branch: 'deployed',
    preview_app_target: '',
    production_app_target: '',
    approval_policy: 'human_required',
    save_choices_as_channel_defaults: false,
    ...overrides,
  };
}

export function inferWorkroomRepo(value, current = {}) {
  const input = String(value || '').trim().replace(/\/$/, '');
  const currentUrl = String(current?.url || '').trim();
  const currentName = String(current?.name || '').trim();
  let url = currentUrl;
  let name = currentName;
  const github = input.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+\/[^/?#]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (github) {
    name = github[1];
    url = `https://github.com/${name}`;
  } else if (/^[^/\s]+\/[^/\s]+$/.test(input)) {
    name = input.replace(/\.git$/, '');
    url = `https://github.com/${name}`;
  } else if (/^https?:\/\//i.test(input)) {
    url = input;
    try {
      const parsed = new URL(input);
      if (parsed.hostname.toLowerCase().endsWith('github.com')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) name = `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
      }
    } catch { /* keep the typed URL as-is */ }
  } else if (input) {
    name = input;
  }
  return { url, name };
}

export function channelParticipantFormRows(channel, getChannelParticipants, getSenderName) {
  const npubs = typeof getChannelParticipants === 'function' ? getChannelParticipants(channel) : [];
  const rows = [...new Set((Array.isArray(npubs) ? npubs : []).map((npub) => String(npub || '').trim()).filter(Boolean))]
    .map((actor_npub) => ({
      actor_npub,
      role: 'contributor',
      label: typeof getSenderName === 'function' ? String(getSenderName(actor_npub) || '').trim() : '',
    }));
  return rows;
}

function text(value) {
  return String(value || '').trim();
}

function valuesFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => typeof entry === 'string'
    ? [text(entry)]
    : [text(entry?.npub || entry?.member_npub || entry?.user_npub || entry?.actor_npub)]
  ).filter(Boolean);
}

function groupMembers(group) {
  return [
    ...valuesFrom(group?.member_npubs),
    ...valuesFrom(group?.effective_member_npubs),
    ...valuesFrom(group?.members),
  ];
}

function channelMemberNpubs(channel) {
  return [
    ...valuesFrom(channel?.member_npubs),
    ...valuesFrom(channel?.visible_member_npubs),
    ...valuesFrom(channel?.channel_member_npubs),
    ...valuesFrom(channel?.members),
    ...valuesFrom(channel?.channel_members),
    ...valuesFrom(channel?.visible_members),
  ];
}

function grantRowsForChannel(channel, channelGrants = []) {
  const embedded = [channel?.channel_grants, channel?.grants, channel?.access_grants]
    .flatMap((rows) => Array.isArray(rows) ? rows : []);
  return [...embedded, ...(Array.isArray(channelGrants) ? channelGrants : [])];
}

/**
 * Resolve the people who can see a channel from materialized visibility data.
 * This intentionally does not fetch: opening the modal must remain usable when
 * PG signing or refreshes are under pressure.
 */
export function workroomVisibleParticipantNpubs(channel, {
  baseParticipants = [],
  groups = [],
  channelGrants = [],
  workspaceMembers = [],
  sessionNpub = '',
  currentViewerNpub = '',
} = {}) {
  const participants = new Set([
    ...valuesFrom(baseParticipants),
    ...valuesFrom(channel?.participant_npubs),
    ...channelMemberNpubs(channel),
  ]);
  const knownGroups = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const ids = [group?.group_id, group?.id, group?.group_npub].map(text).filter(Boolean);
    for (const id of ids) knownGroups.set(id, group);
  }
  for (const groupId of valuesFrom(channel?.group_ids || channel?.groupIds)) {
    for (const npub of groupMembers(knownGroups.get(groupId))) participants.add(npub);
  }

  const actorNpubById = new Map();
  for (const member of Array.isArray(workspaceMembers) ? workspaceMembers : []) {
    const actor = member?.actor && typeof member.actor === 'object' ? member.actor : member;
    const actorId = text(actor?.actor_id || actor?.id || member?.actor_id || member?.id);
    const npub = text(actor?.npub || member?.npub || member?.user_npub || member?.member_npub);
    if (actorId && npub) actorNpubById.set(actorId, npub);
  }
  for (const grant of grantRowsForChannel(channel, channelGrants)) {
    const principalType = text(grant?.principal_type || grant?.stored_principal_type || grant?.principal?.type);
    const principalId = text(grant?.principal_id || grant?.principal?.actor_id || grant?.principal?.id);
    if (principalType === 'actor' || principalType === 'person') {
      const npub = text(grant?.principal_npub || grant?.actor_npub || grant?.npub || grant?.principal?.npub)
        || actorNpubById.get(principalId)
        || (principalId.startsWith('npub1') ? principalId : '');
      if (npub) participants.add(npub);
    } else if (principalType === 'group') {
      for (const npub of groupMembers(knownGroups.get(principalId))) participants.add(npub);
    }
  }

  const viewer = text(currentViewerNpub) || text(sessionNpub);
  if (viewer) participants.add(viewer);
  return [...participants];
}

export function workroomRepoSuggestions(channel, workrooms = []) {
  const values = [];
  const defaults = objectOrEmpty(channel?.metadata)?.[WORKROOM_DEFAULTS_KEY];
  for (const source of [defaults?.repo, defaults, ...(Array.isArray(workrooms) ? workrooms : [])]) {
    const repo = source?.repo || source;
    const repoUrl = repo?.url || repo?.repo_url;
    const repoName = repo?.name || repo?.repo_name;
    if (repoUrl || repoName) values.push(inferWorkroomRepo(repoUrl || repoName, { url: repoUrl, name: repoName }));
  }
  return values.filter((repo, index, all) => repo.url || repo.name ? all.findIndex((candidate) => candidate.url === repo.url && candidate.name === repo.name) === index : false);
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
  const integrationParticipant = participants.find((participant) => participant.role === 'integration');
  return {
    scope_id: scopeId || null,
    channel_id: channelId || null,
    title: String(form?.title || '').trim(),
    goal: String(form?.goal || '').trim(),
    integration_autopilot_npub: integrationParticipant?.actor_npub || null,
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
  const metadata = announcement?.metadata || announcement?.pg_metadata || {};
  const link = String(metadata.workroom_link || '').trim();
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
  workroomMessageMetadata(message) {
    const metadata = message?.pg_metadata || message?.metadata;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  },
  isWorkroomAnnouncement(message) {
    const metadata = this.workroomMessageMetadata(message);
    return Boolean(metadata.workroom_id || metadata.workroom_link || metadata.workroom_status);
  },
  workroomMessageLink(message) {
    const context = resolveTowerPgWorkspaceContext(this);
    return workroomAnnouncementLink({ metadata: this.workroomMessageMetadata(message) }, context.baseUrl);
  },
  openWorkroomCreation() {
    const channel = this.selectedChannel;
    if (!channel?.record_id) {
      this.error = 'Select a channel before creating a workroom.';
      return;
    }
    const form = mergeWorkroomFormWithChannelDefaults(channel);
    const baseParticipants = typeof this.getChannelParticipants === 'function'
      ? this.getChannelParticipants(channel)
      : [];
    const cachedChannelGrants = this.selectedChannelId === channel.record_id
      ? (this.channelGrantRows || this.channelGrants || [])
      : [];
    form.participants = channelParticipantFormRows(
      channel,
      () => workroomVisibleParticipantNpubs(channel, {
        baseParticipants,
        groups: [
          ...(Array.isArray(this.currentWorkspaceGroups) ? this.currentWorkspaceGroups : []),
          ...(Array.isArray(this.groups) ? this.groups : []),
        ],
        channelGrants: cachedChannelGrants,
        workspaceMembers: this.pgWorkspaceMembers,
        sessionNpub: this.session?.npub,
        currentViewerNpub: this.currentPgActorNpub,
      }),
      this.getSenderName?.bind(this),
    );
    form.integration_autopilot_npub = '';
    form.repo_query = form.repo_name || form.repo_url || '';
    this.workroomCreationForm = form;
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

  setWorkroomParticipantRole(index, role) {
    const participant = this.workroomCreationForm.participants?.[index];
    if (!participant) return;
    participant.role = String(role || 'contributor');
    if (participant.role === 'integration') {
      for (const [candidateIndex, candidate] of this.workroomCreationForm.participants.entries()) {
        if (candidateIndex !== index && candidate.role === 'integration') candidate.role = 'contributor';
      }
      this.workroomCreationForm.integration_autopilot_npub = participant.actor_npub;
    } else if (this.workroomCreationForm.integration_autopilot_npub === participant.actor_npub) {
      this.workroomCreationForm.integration_autopilot_npub = '';
    }
  },

  get workroomCreationRepoSuggestions() {
    return workroomRepoSuggestions(this.selectedChannel, this.workrooms);
  },

  selectWorkroomRepo(value) {
    const repo = inferWorkroomRepo(value);
    this.workroomCreationForm.repo_url = repo.url;
    this.workroomCreationForm.repo_name = repo.name;
    this.workroomCreationForm.repo_query = repo.name || repo.url || '';
  },

  get workroomCreationAppTargets() {
    const rows = typeof this.visiblePersonalWapps !== 'undefined' ? this.visiblePersonalWapps : this.wapps;
    return (Array.isArray(rows) ? rows : []).filter((wapp) => wapp?.launch_url).map((wapp) => ({
      value: wapp.launch_url || wapp.record_id,
      label: wapp.title || wapp.launch_url || wapp.record_id,
      subtitle: wapp.launch_url,
    }));
  },

  async createWorkroom({ start = false } = {}) {
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

      this.workroomCreationDraftId = localWorkroom.record_id;
      if (start) await this.startWorkroom(localWorkroom);
      else {
        this.workroomCreationNotice = 'Workroom draft created. Start it from the workroom browser.';
        this.workroomCreationOpen = false;
        await this.refreshWorkrooms({ immediate: true });
      }
    } catch (error) {
      this.setWorkroomCreationError(error?.message || 'Failed to create workroom.');
    } finally {
      this.workroomCreationSubmitting = false;
    }
  },

  async createAndStartWorkroom() {
    return this.createWorkroom({ start: true });
  },

  async startWorkroom(room) {
    const target = room?.record_id ? room : this.workrooms?.find((candidate) => candidate?.record_id === room);
    const context = resolveTowerPgWorkspaceContext(this);
    if (!target?.record_id || !context.workspaceId || !context.baseUrl) return this.setWorkroomCreationError('Workroom or Tower PG workspace is unavailable.');
    if (this.workroomStartingId) return;
    this.workroomStartingId = target.record_id;
    this.workroomError = '';
    try {
      const started = await startTowerPgWorkroom(context.workspaceId, target.record_id, {
        row_version: target.row_version || target.version || 1,
      }, { baseUrl: context.baseUrl, appNpub: context.appNpub });
      const startedRoom = mapPgWorkroomToLocal(started?.workroom || started);
      if (startedRoom.record_id) {
        await upsertWorkroom(startedRoom);
        this.applyWorkrooms?.([startedRoom]);
      }
      this.workroomCreationAnnouncement = started?.announcement_message || started?.announcement || null;
      this.workroomCreationNotice = 'Workroom started in this channel.';
      if (typeof this.refreshMessages === 'function') await this.refreshMessages({ scrollToLatest: true });
      await this.refreshWorkrooms({ immediate: true });
    } catch (error) {
      this.workroomError = 'Could not start this workroom. Retry when Tower is available.';
    } finally {
      this.workroomStartingId = '';
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
    workroomCreationDraftId: '',
    workroomStartingId: '',
  };
}
