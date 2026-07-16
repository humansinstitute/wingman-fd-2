import {
  getPendingWorkroomApprovals as readPendingWorkroomApprovals,
  getWorkroomsByChannel,
  getWorkroomsByWorkspace,
} from './db.js';

export const ACTIVE_WORKROOM_STATUSES = new Set([
  'draft',
  'active',
  'waiting_review',
  'waiting_approval',
  'integrating',
  'deploying',
  'blocked',
]);

export function isArchivedWorkroom(workroom = {}) {
  const status = String(workroom?.status || '').trim();
  return status === 'archived' || Boolean(workroom?.archived_at);
}

export function isActiveWorkroom(workroom = {}) {
  if (!workroom || workroom.record_state === 'deleted' || workroom.deleted_at) return false;
  if (isArchivedWorkroom(workroom)) return false;
  const status = String(workroom.status || '').trim() || 'draft';
  return ACTIVE_WORKROOM_STATUSES.has(status);
}

function workroomRecentTimestamp(workroom = {}) {
  const timestamps = [
    workroom?.updated_at,
    workroom?.archived_at,
    workroom?.completed_at,
    workroom?.created_at,
  ].map((value) => String(value || '')).filter(Boolean).sort();
  return timestamps.length ? timestamps[timestamps.length - 1] : '';
}

export function sortWorkroomsByRecentUpdate(workrooms = []) {
  return [...(Array.isArray(workrooms) ? workrooms : [])].sort((a, b) => (
    workroomRecentTimestamp(b).localeCompare(workroomRecentTimestamp(a))
    || String(b?.record_id || '').localeCompare(String(a?.record_id || ''))
  ));
}

export function filterCurrentChannelWorkrooms(workrooms = [], channelId) {
  const targetChannelId = String(channelId || '').trim();
  if (!targetChannelId) return [];
  return sortWorkroomsByRecentUpdate(workrooms.filter((workroom) => (
    workroom?.channel_id === targetChannelId
    && workroom.record_state !== 'deleted'
    && !workroom.deleted_at
  )));
}

export function filterActiveWorkrooms(workrooms = []) {
  return sortWorkroomsByRecentUpdate(workrooms.filter(isActiveWorkroom));
}

export function filterArchivedWorkrooms(workrooms = []) {
  return sortWorkroomsByRecentUpdate((Array.isArray(workrooms) ? workrooms : []).filter((workroom) => (
    workroom?.record_state !== 'deleted'
    && !workroom?.deleted_at
    && isArchivedWorkroom(workroom)
  )));
}

function flattenSearchValues(value, output = []) {
  if (value == null) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) flattenSearchValues(entry, output);
    return output;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value)) flattenSearchValues(entry, output);
  }
  return output;
}

export function searchWorkroomRows(workrooms = [], query = '') {
  const needle = String(query || '').trim().toLowerCase();
  const rows = Array.isArray(workrooms) ? workrooms : [];
  if (!needle) return sortWorkroomsByRecentUpdate(rows);
  return sortWorkroomsByRecentUpdate(rows.filter((workroom) => {
    const haystack = [
      workroom?.title,
      workroom?.goal,
      workroom?.status,
      workroom?.integration_autopilot_npub,
      ...flattenSearchValues(workroom?.repo),
      ...flattenSearchValues(workroom?.branches),
      ...flattenSearchValues(workroom?.app_targets),
      ...flattenSearchValues(workroom?.metadata),
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  }));
}

export async function getCurrentChannelWorkrooms(channelId) {
  return filterCurrentChannelWorkrooms(await getWorkroomsByChannel(channelId), channelId);
}

export async function getCurrentChannelActiveWorkrooms(channelId) {
  return filterActiveWorkrooms(await getCurrentChannelWorkrooms(channelId));
}

export async function getCurrentChannelArchivedWorkrooms(channelId) {
  return filterArchivedWorkrooms(await getCurrentChannelWorkrooms(channelId));
}

export async function searchLocalWorkrooms(query, { workspaceId = null, channelId = null } = {}) {
  if (!workspaceId && !channelId) return [];
  const rows = workspaceId ? await getWorkroomsByWorkspace(workspaceId) : await getWorkroomsByChannel(channelId);
  return searchWorkroomRows(channelId ? filterCurrentChannelWorkrooms(rows, channelId) : rows, query);
}

export async function getPendingWorkroomApprovals(options = {}) {
  return readPendingWorkroomApprovals(options);
}
