import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields } from './group-refs.js';

const WAPP_COLLECTION_SPACE = 'wapp';

export function recordFamilyHash(collectionSpace = WAPP_COLLECTION_SPACE) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeNullableString(value) {
  const text = normalizeString(value);
  return text || null;
}

function normalizeLaunchUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function groupIdsFromRecord(record = {}) {
  return [...new Set((record.group_payloads || [])
    .map((payload) => payload?.group_id || payload?.group_npub)
    .map((value) => normalizeString(value))
    .filter(Boolean))];
}

function normalizeRecordState(value) {
  if (value === 'archived') return 'archived';
  if (value === 'deleted') return 'deleted';
  return 'active';
}

function normalizeStatus(value, recordState = 'active') {
  if (value === 'archived' || recordState === 'archived' || recordState === 'deleted') return 'archived';
  return 'active';
}

function normalizeTime(value) {
  const text = normalizeString(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

function normalizeScheduleWindow(value) {
  if (!value || typeof value !== 'object') return null;
  const startTime = normalizeTime(value.start_time ?? value.startTime);
  const endTime = normalizeTime(value.end_time ?? value.endTime);
  if (!startTime || !endTime) return null;
  const days = Array.isArray(value.days)
    ? [...new Set(value.days
      .map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      .sort((left, right) => left - right)
    : [];
  return {
    ...(days.length ? { days } : {}),
    start_time: startTime,
    end_time: endTime,
  };
}

function normalizeIsoString(value) {
  const text = normalizeString(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeSchedule(value) {
  if (!value || typeof value !== 'object') return null;
  const windows = Array.isArray(value.windows)
    ? value.windows.map(normalizeScheduleWindow).filter(Boolean)
    : [];
  const schedule = {
    timezone: normalizeNullableString(value.timezone),
    starts_at: normalizeIsoString(value.starts_at ?? value.startsAt),
    ends_at: normalizeIsoString(value.ends_at ?? value.endsAt),
    windows,
  };
  if (!schedule.timezone && !schedule.starts_at && !schedule.ends_at && windows.length === 0) return null;
  return schedule;
}

function normalizeWappData(data = {}, record = {}) {
  const title = normalizeString(data.title);
  const launchUrl = normalizeLaunchUrl(data.launch_url);
  if (!title) throw new Error('wapp title is required');
  if (!launchUrl) throw new Error('wapp launch_url must be an http(s) URL');
  const recordState = normalizeRecordState(data.record_state);

  return {
    title,
    description: normalizeNullableString(data.description),
    owner_npub: normalizeString(data.owner_npub || record.owner_npub),
    wapp_id: normalizeString(data.wapp_id),
    app_id: normalizeString(data.app_id),
    launch_url: launchUrl,
    source_wingman_url: normalizeLaunchUrl(data.source_wingman_url) || null,
    workspace_owner_npub: normalizeString(data.workspace_owner_npub || record.owner_npub),
    scope_id: normalizeNullableString(data.scope_id),
    scope_l1_id: normalizeNullableString(data.scope_l1_id),
    scope_l2_id: normalizeNullableString(data.scope_l2_id),
    scope_l3_id: normalizeNullableString(data.scope_l3_id),
    scope_l4_id: normalizeNullableString(data.scope_l4_id),
    scope_l5_id: normalizeNullableString(data.scope_l5_id),
    status: normalizeStatus(data.status, recordState),
    schedule: normalizeSchedule(data.schedule),
    record_state: recordState,
  };
}

export async function inboundWapp(record) {
  const payload = await decryptRecordPayload(record);
  const data = normalizeWappData(payload.data ?? payload, record);

  return {
    record_id: normalizeString(record.record_id || payload.record_id),
    owner_npub: data.owner_npub,
    title: data.title,
    description: data.description,
    wapp_id: data.wapp_id,
    app_id: data.app_id,
    launch_url: data.launch_url,
    source_wingman_url: data.source_wingman_url,
    workspace_owner_npub: data.workspace_owner_npub,
    scope_id: data.scope_id,
    scope_l1_id: data.scope_l1_id,
    scope_l2_id: data.scope_l2_id,
    scope_l3_id: data.scope_l3_id,
    scope_l4_id: data.scope_l4_id,
    scope_l5_id: data.scope_l5_id,
    status: data.status,
    schedule: data.schedule,
    group_ids: groupIdsFromRecord(record),
    sync_status: 'synced',
    record_state: data.record_state,
    version: record.version ?? 1,
    created_at: record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundWapp({
  record_id,
  owner_npub,
  record_owner_npub = null,
  title,
  description = null,
  wapp_id,
  app_id,
  launch_url,
  source_wingman_url = null,
  workspace_owner_npub = owner_npub,
  scope_id = null,
  scope_l1_id = null,
  scope_l2_id = null,
  scope_l3_id = null,
  scope_l4_id = null,
  scope_l5_id = null,
  status = 'active',
  schedule = null,
  group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_ref = null,
  record_state = 'active',
}) {
  const data = normalizeWappData({
    title,
    description,
    owner_npub,
    wapp_id,
    app_id,
    launch_url,
    source_wingman_url,
    workspace_owner_npub,
    scope_id,
    scope_l1_id,
    scope_l2_id,
    scope_l3_id,
    scope_l4_id,
    scope_l5_id,
    status,
    schedule,
    record_state,
  }, { owner_npub });

  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: WAPP_COLLECTION_SPACE,
    schema_version: 1,
    record_id,
    data,
  };
  const envelopeOwnerNpub = normalizeString(record_owner_npub || workspace_owner_npub || owner_npub);

  return {
    record_id,
    owner_npub: envelopeOwnerNpub,
    record_family_hash: recordFamilyHash(WAPP_COLLECTION_SPACE),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(envelopeOwnerNpub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
