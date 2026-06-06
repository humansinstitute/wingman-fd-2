/**
 * V4 API client — all network calls live here (or in the sync worker).
 * The UI never calls these directly; the worker or explicit user actions do.
 */

import { SuperbasedClient } from '@nostr-superbased/core/client';
import { createNip98AuthHeader, createNip98AuthHeaderForSecret } from './auth/nostr.js';
import { getActiveSessionNpub } from './crypto/group-keys.js';
import { getActiveWorkspaceKeyNpub, getActiveWorkspaceKeySecretForAuth } from './crypto/workspace-keys.js';
import { buildFlightDeckSyncRequest } from './superbased/sync-request.js';
import { FLIGHT_DECK_PG_APP_NPUB } from './app-identity.js';

let _baseUrl = '';

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const UPLOAD_FETCH_TIMEOUT_MS = 60_000;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function setBaseUrl(url) {
  _baseUrl = url.replace(/\/+$/, '');
}

export function getBaseUrl() {
  return _baseUrl;
}

function url(path) {
  return `${_baseUrl}${path}`;
}

function getEffectiveViewerNpub(viewerNpub = null) {
  return String(
    viewerNpub
    || getActiveSessionNpub()
    || ''
  ).trim();
}

function getWorkspaceKeyNpubForAuth() {
  if (!getActiveWorkspaceKeySecretForAuth()) return null;
  return String(getActiveWorkspaceKeyNpub() || '').trim() || null;
}

function getEffectiveReadViewerNpub(viewerNpub = null) {
  return getWorkspaceKeyNpubForAuth() || getEffectiveViewerNpub(viewerNpub);
}

function addWorkspaceKeyAuthParams(params) {
  const workspaceKeyNpub = getWorkspaceKeyNpubForAuth();
  if (!workspaceKeyNpub) return null;
  params.set('workspace_user_key_npub', workspaceKeyNpub);
  params.set('ws_key_npub', workspaceKeyNpub);
  return workspaceKeyNpub;
}

function addWorkspaceKeyAuthBodyFields(body) {
  const workspaceKeyNpub = getWorkspaceKeyNpubForAuth();
  if (!workspaceKeyNpub) return body;
  return {
    ...body,
    workspace_user_key_npub: workspaceKeyNpub,
    ws_key_npub: workspaceKeyNpub,
  };
}

async function createApiAuthHeader(requestUrl, method, body = null, options = {}) {
  const workspaceSecret = options.useWorkspaceKey === false
    ? null
    : getActiveWorkspaceKeySecretForAuth();
  if (workspaceSecret) {
    return createNip98AuthHeaderForSecret(requestUrl, method, body ?? null, workspaceSecret);
  }
  return createNip98AuthHeader(requestUrl, method, body ?? null);
}

async function buildApiError(resp, { requestUrl = '', method = 'GET', prefix = 'API' } = {}) {
  const text = await resp.text().catch(() => '');
  const requestMethod = String(method || 'GET').toUpperCase();
  const location = requestUrl ? ` ${requestMethod} ${requestUrl}` : '';
  const suffix = text ? `: ${text}` : '';
  const error = new Error(`${prefix} ${resp.status}${location}${suffix}`);
  error.status = resp.status;
  error.method = requestMethod;
  error.requestUrl = requestUrl || null;
  error.responseText = text;
  return error;
}

async function json(resp, requestMeta = {}) {
  if (!resp.ok) {
    throw await buildApiError(resp, requestMeta);
  }
  return resp.json();
}

async function signedFetch(path, { method = 'GET', body } = {}, options = {}) {
  const requestUrl = url(path);
  const headers = {
    Authorization: await createApiAuthHeader(requestUrl, method, body ?? null, options),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(requestUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });
}

function buildCoreApiClient() {
  return new SuperbasedClient({
    connection: { url: _baseUrl },
    auth: {
      kind: 'wingman-fd-api',
      async getPublicNpub() {
        return getActiveSessionNpub() || '';
      },
      async createNip98AuthHeader(requestUrl, method, body) {
        return createApiAuthHeader(requestUrl, method, body ?? null);
      },
      async nip44EncryptToNpub() {
        throw new Error('NIP-44 encryption is not available through the Flight Deck API bridge.');
      },
      async nip44DecryptFromNpub() {
        throw new Error('NIP-44 decryption is not available through the Flight Deck API bridge.');
      },
    },
  });
}

async function signedFetchAbsolute(requestUrl, { method = 'GET', body } = {}, options = {}) {
  const headers = {
    Authorization: await createApiAuthHeader(requestUrl, method, body ?? null, options),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(requestUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });
}

function resolveTowerPgUrl(pathOrUrl, baseUrl = _baseUrl) {
  const value = String(pathOrUrl || '').trim();
  if (!value) throw new Error('Tower PG request path is required');
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(baseUrl || _baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Backend URL not configured');
  return `${base}${value.startsWith('/') ? value : `/${value}`}`;
}

async function signedTowerPgFetch(pathOrUrl, { method = 'GET', body, baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const requestUrl = resolveTowerPgUrl(pathOrUrl, baseUrl);
  const headers = {
    Authorization: await createApiAuthHeader(requestUrl, method, body ?? null, { useWorkspaceKey: false }),
  };
  const cleanAppNpub = String(appNpub || '').trim();
  if (cleanAppNpub) headers['x-flightdeck-pg-app-npub'] = cleanAppNpub;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(requestUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });
}

async function signedFetchWithFallbacks(path, { method = 'GET', body } = {}, options = {}) {
  const result = await signedFetchWithFallbackMeta(path, { method, body }, options);
  return result.response;
}

async function signedFetchWithFallbackMeta(path, { method = 'GET', body } = {}, options = {}) {
  if (!_baseUrl) {
    throw new Error('Backend URL not configured');
  }
  const requestUrl = `${_baseUrl}${path}`;
  const response = await signedFetchAbsolute(requestUrl, { method, body }, options);
  return { response, requestUrl };
}

async function signedFetchBytes(path) {
  const requestUrl = url(path);
  const resp = await signedFetch(path);
  if (!resp.ok) {
    throw await buildApiError(resp, { requestUrl, method: 'GET' });
  }
  return new Uint8Array(await resp.arrayBuffer());
}

async function signedFetchBlob(path) {
  const requestUrl = url(path);
  const resp = await signedFetch(path);
  if (!resp.ok) {
    throw await buildApiError(resp, { requestUrl, method: 'GET' });
  }
  return resp.blob();
}

// --- Groups ---

export async function createGroup({ owner_npub, name, group_npub, member_keys }) {
  const requestUrl = url('/api/v4/groups');
  const resp = await signedFetch('/api/v4/groups', {
    method: 'POST',
    body: { owner_npub, name, group_npub, member_keys },
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function addGroupMember(groupId, { member_npub, wrapped_group_nsec, wrapped_by_npub }) {
  const requestPath = `/api/v4/groups/${groupId}/members`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(`/api/v4/groups/${groupId}/members`, {
    method: 'POST',
    body: { member_npub, wrapped_group_nsec, wrapped_by_npub },
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function rotateGroup(groupId, { group_npub, member_keys, name }) {
  const requestPath = `/api/v4/groups/${groupId}/rotate`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(`/api/v4/groups/${groupId}/rotate`, {
    method: 'POST',
    body: { group_npub, member_keys, name },
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function deleteGroupMember(groupId, memberNpub) {
  const requestPath = `/api/v4/groups/${groupId}/members/${encodeURIComponent(memberNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath, {
    method: 'DELETE',
  });
  return json(resp, { requestUrl, method: 'DELETE' });
}

export async function getGroups(npub) {
  const requestPath = `/api/v4/groups?npub=${encodeURIComponent(npub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

// Tower resolves this route for the authenticated actor/workspace-key path.
// Callers must treat it as self-only readable state, not a way to probe
// wrapped keys for arbitrary other members.
export async function getGroupKeys(memberNpub) {
  const requestPath = `/api/v4/groups/keys?member_npub=${encodeURIComponent(memberNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function updateGroup(groupId, { name }) {
  const requestPath = `/api/v4/groups/${groupId}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(`/api/v4/groups/${groupId}`, {
    method: 'PATCH',
    body: { name },
  });
  return json(resp, { requestUrl, method: 'PATCH' });
}

export async function deleteGroup(groupId) {
  const requestPath = `/api/v4/groups/${groupId}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(`/api/v4/groups/${groupId}`, {
    method: 'DELETE',
  });
  return json(resp, { requestUrl, method: 'DELETE' });
}

// --- Workspaces ---

export async function createWorkspace(body) {
  const requestPath = '/api/v4/workspaces';
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks('/api/v4/workspaces', {
    method: 'POST',
    body,
  }, { useWorkspaceKey: false });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function getWorkspaces(memberNpub) {
  const requestPath = `/api/v4/workspaces?member_npub=${encodeURIComponent(memberNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks(requestPath, {}, { useWorkspaceKey: false });
  return json(resp, { requestUrl, method: 'GET' });
}

export async function getTowerPgService({ baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const requestPath = '/api/v4/flightdeck-pg/service';
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function listTowerPgWorkspaces({ baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (appNpub) params.set('app_npub', String(appNpub));
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces?${params.toString()}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function createTowerPgAdminWorkspace(body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const requestPath = '/api/v4/admin/flightdeck-pg/workspaces';
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG Admin API' });
}

export async function getTowerPgWorkspaceDescriptor(workspaceId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, path = null } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  if (!encodedWorkspaceId && !path) throw new Error('Tower PG workspace id is required');
  const requestPath = path || `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/descriptor`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgWorkspaceMe(workspaceId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, path = null } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  if (!encodedWorkspaceId && !path) throw new Error('Tower PG workspace id is required');
  const requestPath = path || `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/me`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgWorkspaceMembers(workspaceId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/members${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function createTowerPgWorkspaceMember(workspaceId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/members`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function getTowerPgWorkspaceGroups(workspaceId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/groups${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function createTowerPgWorkspaceGroup(workspaceId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/groups`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function addTowerPgWorkspaceGroupMember(workspaceId, groupId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedGroupId = encodeURIComponent(String(groupId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedGroupId) throw new Error('Tower PG group id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/groups/${encodedGroupId}/members`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function removeTowerPgWorkspaceGroupMember(workspaceId, groupId, actorId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedGroupId = encodeURIComponent(String(groupId || '').trim());
  const encodedActorId = encodeURIComponent(String(actorId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedGroupId) throw new Error('Tower PG group id is required');
  if (!encodedActorId) throw new Error('Tower PG actor id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/groups/${encodedGroupId}/members/${encodedActorId}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'DELETE', baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'DELETE', prefix: 'Tower PG API' });
}

export async function addTowerPgWorkspaceChildGroup(workspaceId, parentGroupId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedGroupId = encodeURIComponent(String(parentGroupId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedGroupId) throw new Error('Tower PG group id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/groups/${encodedGroupId}/child-groups`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function removeTowerPgWorkspaceChildGroup(workspaceId, parentGroupId, childGroupId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedGroupId = encodeURIComponent(String(parentGroupId || '').trim());
  const encodedChildGroupId = encodeURIComponent(String(childGroupId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedGroupId) throw new Error('Tower PG group id is required');
  if (!encodedChildGroupId) throw new Error('Tower PG child group id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/groups/${encodedGroupId}/child-groups/${encodedChildGroupId}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'DELETE', baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'DELETE', prefix: 'Tower PG API' });
}

export async function getTowerPgChannelGrants(workspaceId, channelId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/grants`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function createTowerPgChannelGrant(workspaceId, channelId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/grants`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function getTowerPgWorkspaceScopes(workspaceId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, path = null, limit = 100 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  if (!encodedWorkspaceId && !path) throw new Error('Tower PG workspace id is required');
  const requestPath = path || `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/scopes`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const finalPath = params.size > 0
    ? `${requestPath}${requestPath.includes('?') ? '&' : '?'}${params.toString()}`
    : requestPath;
  const finalUrl = params.size > 0
    ? `${requestUrl}${requestUrl.includes('?') ? '&' : '?'}${params.toString()}`
    : requestUrl;
  const resp = await signedTowerPgFetch(finalPath, { baseUrl, appNpub });
  return json(resp, { requestUrl: finalUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function createTowerPgWorkspaceScope(workspaceId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/scopes`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function getTowerPgScopeChannels(workspaceId, scopeId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 100 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedScopeId = encodeURIComponent(String(scopeId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedScopeId) throw new Error('Tower PG scope id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/scopes/${encodedScopeId}/channels${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgChannelThreads(workspaceId, channelId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 100 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/threads${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgChannelMessages(workspaceId, channelId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, threadId = null, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const params = new URLSearchParams();
  if (threadId) params.set('thread_id', String(threadId));
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/messages${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgChannelTasks(workspaceId, channelId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/tasks${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgScopeTasks(workspaceId, scopeId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedScopeId = encodeURIComponent(String(scopeId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedScopeId) throw new Error('Tower PG scope id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/scopes/${encodedScopeId}/tasks${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgTaskComments(workspaceId, taskId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedTaskId = encodeURIComponent(String(taskId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedTaskId) throw new Error('Tower PG task id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/tasks/${encodedTaskId}/comments${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgChannelDocs(workspaceId, channelId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/docs${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgChannelFiles(workspaceId, channelId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/files${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function getTowerPgChannelAudioNotes(workspaceId, channelId, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB, limit = 200 } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/audio-notes${params.size > 0 ? `?${params.toString()}` : ''}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'GET', prefix: 'Tower PG API' });
}

export async function createTowerPgChannelTask(workspaceId, channelId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/tasks`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function createTowerPgChannelDoc(workspaceId, channelId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/docs`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function createTowerPgChannelFile(workspaceId, channelId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/files`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function createTowerPgChannelAudioNote(workspaceId, channelId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/audio-notes`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function updateTowerPgTask(workspaceId, taskId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedTaskId = encodeURIComponent(String(taskId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedTaskId) throw new Error('Tower PG task id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/tasks/${encodedTaskId}`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'PATCH', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'PATCH', prefix: 'Tower PG API' });
}

export async function updateTowerPgTaskState(workspaceId, taskId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedTaskId = encodeURIComponent(String(taskId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedTaskId) throw new Error('Tower PG task id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/tasks/${encodedTaskId}/state`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function createTowerPgTaskComment(workspaceId, taskId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedTaskId = encodeURIComponent(String(taskId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedTaskId) throw new Error('Tower PG task id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/tasks/${encodedTaskId}/comments`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function createTowerPgChannelMessage(workspaceId, channelId, body, { baseUrl = _baseUrl, appNpub = FLIGHT_DECK_PG_APP_NPUB } = {}) {
  const encodedWorkspaceId = encodeURIComponent(String(workspaceId || '').trim());
  const encodedChannelId = encodeURIComponent(String(channelId || '').trim());
  if (!encodedWorkspaceId) throw new Error('Tower PG workspace id is required');
  if (!encodedChannelId) throw new Error('Tower PG channel id is required');
  const requestPath = `/api/v4/flightdeck-pg/workspaces/${encodedWorkspaceId}/channels/${encodedChannelId}/messages`;
  const requestUrl = resolveTowerPgUrl(requestPath, baseUrl);
  const resp = await signedTowerPgFetch(requestPath, { method: 'POST', body, baseUrl, appNpub });
  return json(resp, { requestUrl, method: 'POST', prefix: 'Tower PG API' });
}

export async function recoverWorkspace(body) {
  const requestPath = '/api/v4/workspaces/recover';
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks('/api/v4/workspaces/recover', {
    method: 'POST',
    body,
  }, { useWorkspaceKey: false });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function updateWorkspace(workspaceOwnerNpub, body) {
  const requestPath = `/api/v4/workspaces/${encodeURIComponent(workspaceOwnerNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks(requestPath, {
    method: 'PATCH',
    body,
  });
  return json(resp, { requestUrl, method: 'PATCH' });
}

export async function registerWorkspaceApp(workspaceOwnerNpub, { app_npub, app_name }) {
  const requestPath = `/api/v4/workspaces/${encodeURIComponent(workspaceOwnerNpub)}/apps`;
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks(requestPath, {
    method: 'POST',
    body: { app_npub, app_name },
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function publishWorkspaceAppSchema(workspaceOwnerNpub, appNpub, body) {
  const requestPath = `/api/v4/workspaces/${encodeURIComponent(workspaceOwnerNpub)}/apps/${encodeURIComponent(appNpub)}/schemas`;
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks(requestPath, {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function fetchWorkspaceAppSchemas(workspaceOwnerNpub, { app_npub, latest = true } = {}) {
  const params = new URLSearchParams();
  if (app_npub) params.set('app_npub', app_npub);
  if (latest !== undefined) params.set('latest', latest ? 'true' : 'false');
  const requestPath = `/api/v4/workspaces/${encodeURIComponent(workspaceOwnerNpub)}/app-schemas${params.size ? `?${params}` : ''}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks(requestPath, {});
  return json(resp, { requestUrl, method: 'GET' });
}

export async function registerWorkspaceKey({ workspace_owner_npub, ws_key_npub }) {
  const requestPath = '/api/v4/user/workspace-keys';
  const requestUrl = url(requestPath);
  const body = { workspace_owner_npub, ws_key_npub };
  const resp = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      Authorization: await createNip98AuthHeader(requestUrl, 'POST', body),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });
  return json(resp, { requestUrl, method: 'POST' });
}

// --- Storage ---

export async function prepareStorageObject(body) {
  const requestPath = '/api/v4/storage/prepare';
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath, {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function uploadStorageObject(prepared, bytes, contentType = 'application/octet-stream') {
  const uploadUrl = String(prepared?.upload_url || '').trim();
  const payload = {
    base64_data: bytesToBase64(bytes),
  };
  const fallbackPath = `/api/v4/storage/${prepared.object_id}`;
  const { response: fallbackResp, requestUrl: fallbackUrl } = await signedFetchWithFallbackMeta(fallbackPath, {
    method: 'PUT',
    body: payload,
  });
  if (fallbackResp.ok) {
    return json(fallbackResp, { requestUrl: fallbackUrl, method: 'PUT' });
  }

  const fallbackError = await buildApiError(fallbackResp, {
    requestUrl: fallbackUrl,
    method: 'PUT',
  });
  if (fallbackResp.status !== 404 && fallbackResp.status !== 405) {
    throw fallbackError;
  }

  if (!uploadUrl) {
    throw fallbackError;
  }

  let directUploadFailure = null;
  let directResp;
  try {
    directResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: bytes,
      signal: AbortSignal.timeout(UPLOAD_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    directUploadFailure = error instanceof Error ? error : new Error(String(error));
  }

  if (directResp?.ok) {
    return {
      object_id: prepared.object_id,
      size_bytes: bytes.byteLength,
      content_type: contentType,
    };
  }

  if (directResp && !directResp.ok) {
    directUploadFailure = await buildApiError(directResp, {
      requestUrl: uploadUrl,
      method: 'PUT',
      prefix: 'Storage upload',
    });
  }

  if (directUploadFailure) {
    fallbackError.directUploadMessage = directUploadFailure.message;
    fallbackError.message = `${fallbackError.message} | direct upload failed after backend upload fallback: ${directUploadFailure.message}`;
  }
  throw fallbackError;
}

export async function completeStorageObject(objectId, body = {}) {
  const requestPath = `/api/v4/storage/${objectId}/complete`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath, {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function getStorageDownloadUrl(objectId) {
  const requestPath = `/api/v4/storage/${objectId}/download-url`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function getStorageObject(objectId) {
  const requestPath = `/api/v4/storage/${objectId}`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function downloadStorageObject(objectId) {
  const requestPath = `/api/v4/storage/${objectId}/content`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  if (!resp.ok) {
    throw await buildApiError(resp, { requestUrl, method: 'GET' });
  }
  return new Uint8Array(await resp.arrayBuffer());
}

export async function downloadStorageObjectBlob(objectId, options = {}) {
  const requestPath = `/api/v4/storage/${objectId}/content`;
  const explicitBackendUrl = String(options?.backendUrl || '').trim().replace(/\/+$/, '');
  if (explicitBackendUrl) {
    const requestUrl = `${explicitBackendUrl}${requestPath}`;
    const resp = await signedFetchAbsolute(requestUrl);
    if (!resp.ok) {
      throw await buildApiError(resp, { requestUrl, method: 'GET' });
    }
    return resp.blob();
  }
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  if (!resp.ok) {
    throw await buildApiError(resp, { requestUrl, method: 'GET' });
  }
  return resp.blob();
}

// --- Records heartbeat ---

export async function fetchHeartbeat({ owner_npub, viewer_npub, family_cursors }) {
  const requestUrl = url('/api/v4/records/heartbeat');
  const effectiveViewerNpub = getEffectiveReadViewerNpub(viewer_npub);
  const body = addWorkspaceKeyAuthBodyFields({
    owner_npub,
    family_cursors,
    ...(effectiveViewerNpub ? { viewer_npub: effectiveViewerNpub } : {}),
  });
  const resp = await signedFetch('/api/v4/records/heartbeat', {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

// --- Records summary ---

export async function fetchRecordsSummary(ownerNpub) {
  try {
    const params = new URLSearchParams({ owner_npub: ownerNpub });
    addWorkspaceKeyAuthParams(params);
    const resp = await signedFetch(`/api/v4/records/summary?${params}`);
    if (resp.status === 404 || resp.status === 405) {
      return { available: false, families: [] };
    }
    const data = await json(resp);
    return { available: true, ...data };
  } catch {
    return { available: false, families: [] };
  }
}

// --- Records sync ---

export async function acquireRecordCheckout(input) {
  return buildCoreApiClient().records.acquireCheckout(input);
}

export async function releaseRecordCheckout(input) {
  return buildCoreApiClient().records.releaseCheckout(input);
}

export async function syncRecords({ owner_npub, records, signing_npub, checkout_policy_config }) {
  const syncRequest = await buildFlightDeckSyncRequest({
    ownerNpub: owner_npub,
    records,
    signingNpub: signing_npub,
    baseUrl: _baseUrl,
    checkoutPolicyConfig: checkout_policy_config,
  });
  const deferredRecordIds = Array.isArray(syncRequest.deferred_record_ids)
    ? syncRequest.deferred_record_ids
    : [];

  if (syncRequest.records.length === 0) {
    return { synced: 0, created: 0, updated: 0, rejected: [], deferred: deferredRecordIds };
  }

  const requestUrl = url('/api/v4/records/sync');
  const resp = await signedFetch('/api/v4/records/sync', {
    method: 'POST',
    body: {
      owner_npub: syncRequest.owner_npub,
      workspace_service_npub: syncRequest.workspace_service_npub,
      ...(syncRequest.user_npub ? { user_npub: syncRequest.user_npub } : {}),
      ...(syncRequest.actor_npub ? { actor_npub: syncRequest.actor_npub } : {}),
      ...(syncRequest.viewer_npub ? { viewer_npub: syncRequest.viewer_npub } : {}),
      ...(syncRequest.signer_npub ? { signer_npub: syncRequest.signer_npub } : {}),
      ...(syncRequest.workspace_user_key_npub ? { workspace_user_key_npub: syncRequest.workspace_user_key_npub } : {}),
      ...(syncRequest.ws_key_npub ? { ws_key_npub: syncRequest.ws_key_npub } : {}),
      records: syncRequest.records,
      group_write_tokens: syncRequest.group_write_tokens,
    },
  });
  const result = await json(resp, { requestUrl, method: 'POST' });
  result.deferred = deferredRecordIds;
  return result;
}

export async function fetchRecordHistory({ record_id, owner_npub, viewer_npub }) {
  const params = new URLSearchParams({ owner_npub });
  addWorkspaceKeyAuthParams(params);
  const effectiveViewerNpub = getEffectiveReadViewerNpub(viewer_npub);
  if (effectiveViewerNpub) params.set('viewer_npub', effectiveViewerNpub);
  const requestPath = `/api/v4/records/${encodeURIComponent(record_id)}/history?${params}`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function fetchWorkspaceKeyMappings(ownerNpub) {
  const requestPath = `/api/v4/user/workspace-key-mappings?workspace_owner_npub=${encodeURIComponent(ownerNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function fetchRecords({ owner_npub, viewer_npub, record_family_hash, since }) {
  const PAGE_SIZE = 1000;
  const allRecords = [];
  let offset = 0;
  let firstPage = null;
  let lastPage = null;
  let firstRequestUrl = null;

  while (true) {
    const params = new URLSearchParams({ owner_npub });
    addWorkspaceKeyAuthParams(params);
    const effectiveViewerNpub = getEffectiveReadViewerNpub(viewer_npub);
    if (effectiveViewerNpub) params.set('viewer_npub', effectiveViewerNpub);
    if (record_family_hash) params.set('record_family_hash', record_family_hash);
    if (since) params.set('since', since);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));

    const requestPath = `/api/v4/records?${params}`;
    const requestUrl = url(requestPath);
    if (!firstRequestUrl) firstRequestUrl = requestUrl;
    const resp = await signedFetch(requestPath);
    const page = await json(resp, { requestUrl, method: 'GET' });
    if (!firstPage) firstPage = page;
    lastPage = page;

    const records = Array.isArray(page.records) ? page.records : [];
    allRecords.push(...records);
    if (!page.has_more || records.length === 0) break;
    offset += records.length;
  }

  return {
    ...(firstPage || {}),
    ...(lastPage || {}),
    requestUrl: firstRequestUrl || lastPage?.requestUrl || '',
    records: allRecords,
    limit: PAGE_SIZE,
    offset: 0,
    has_more: false,
  };
}
