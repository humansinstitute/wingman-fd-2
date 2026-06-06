import {
  acquireTowerPgEditLease,
  releaseTowerPgEditLease,
  renewTowerPgEditLease,
} from './api.js';
import { resolveTowerPgWorkspaceContext } from './pg-read-hydrator.js';

export const PG_SYNCED_OFFLINE_EDIT_MESSAGE = 'Reconnect to edit this synced Tower PG record.';
export const PG_EDIT_CONFLICT_MESSAGE = 'Another actor is editing this Tower PG record. View mode until the lease is available.';

function trimText(value) {
  return String(value ?? '').trim();
}

export function isOnlineForPgEdit(env = globalThis) {
  return env?.navigator?.onLine !== false;
}

export function isPgBackedRecord(record = null) {
  return Boolean(record?.pg_backend);
}

export function isSyncedPgRecord(record = null) {
  return isPgBackedRecord(record) && trimText(record?.sync_status || 'synced') === 'synced';
}

export function isUnsyncedLocalPgRecord(record = null) {
  return isPgBackedRecord(record) && trimText(record?.sync_status || 'synced') !== 'synced';
}

export function pgEditLeaseSessionKey(entityType, recordId) {
  const cleanType = trimText(entityType);
  const cleanId = trimText(recordId);
  return cleanType && cleanId ? `${cleanType}:${cleanId}` : '';
}

export function getPgEditLeaseSession(store, entityType, recordId) {
  const key = pgEditLeaseSessionKey(entityType, recordId);
  if (!key) return null;
  return store?.pgEditLeaseSessions?.[key] || null;
}

export function setPgEditLeaseSession(store, entityType, recordId, patch = {}) {
  const key = pgEditLeaseSessionKey(entityType, recordId);
  if (!key || !store) return null;
  const current = store.pgEditLeaseSessions?.[key] || {};
  const next = {
    ...current,
    ...patch,
    entityType: trimText(entityType),
    recordId: trimText(recordId),
    updatedAt: new Date().toISOString(),
  };
  store.pgEditLeaseSessions = {
    ...(store.pgEditLeaseSessions || {}),
    [key]: next,
  };
  return next;
}

export function clearPgEditLeaseSession(store, entityType, recordId) {
  const key = pgEditLeaseSessionKey(entityType, recordId);
  if (!key || !store?.pgEditLeaseSessions?.[key]) return;
  const next = { ...(store.pgEditLeaseSessions || {}) };
  delete next[key];
  store.pgEditLeaseSessions = next;
}

function normalizeAcquireError(error) {
  if (Number(error?.status) === 409) {
    error.userMessage = PG_EDIT_CONFLICT_MESSAGE;
    return error;
  }
  error.userMessage = error?.message || 'Unable to acquire Tower PG edit lease.';
  return error;
}

export async function acquirePgEditLeaseForRecord(store, record, entityType, options = {}) {
  if (!isSyncedPgRecord(record)) return null;
  if (!isOnlineForPgEdit(options.env)) {
    const error = new Error(PG_SYNCED_OFFLINE_EDIT_MESSAGE);
    error.userMessage = PG_SYNCED_OFFLINE_EDIT_MESSAGE;
    error.code = 'pg_synced_offline';
    throw error;
  }

  const recordId = trimText(record?.record_id);
  const existing = getPgEditLeaseSession(store, entityType, recordId);
  if (existing?.lease?.lease_token) return existing.lease;

  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.baseUrl) throw new Error('Tower PG workspace is not ready');
  try {
    setPgEditLeaseSession(store, entityType, recordId, { acquireState: 'acquiring', message: '' });
    const result = await acquireTowerPgEditLease(context.workspaceId, {
      entity_type: entityType,
      entity_id: recordId,
      ttl_seconds: options.ttlSeconds || 120,
    }, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    setPgEditLeaseSession(store, entityType, recordId, {
      acquireState: 'held',
      lease: result.lease || null,
      message: '',
    });
    return result.lease || null;
  } catch (error) {
    const normalized = normalizeAcquireError(error);
    setPgEditLeaseSession(store, entityType, recordId, {
      acquireState: 'blocked',
      lease: null,
      message: normalized.userMessage,
    });
    throw normalized;
  }
}

export async function renewPgEditLeaseForRecord(store, record, entityType, options = {}) {
  const recordId = trimText(record?.record_id);
  const session = getPgEditLeaseSession(store, entityType, recordId);
  if (!session?.lease?.id || !session?.lease?.lease_token) return null;
  const context = resolveTowerPgWorkspaceContext(store);
  const result = await renewTowerPgEditLease(context.workspaceId, session.lease.id, {
    lease_token: session.lease.lease_token,
    ttl_seconds: options.ttlSeconds || 120,
  }, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  setPgEditLeaseSession(store, entityType, recordId, { acquireState: 'held', lease: result.lease || session.lease });
  return result.lease || session.lease;
}

export async function releasePgEditLeaseForRecord(store, record, entityType, options = {}) {
  const recordId = trimText(record?.record_id);
  const session = getPgEditLeaseSession(store, entityType, recordId);
  if (!session?.lease?.id || !session?.lease?.lease_token) return false;
  try {
    const context = resolveTowerPgWorkspaceContext(store);
    await releaseTowerPgEditLease(context.workspaceId, session.lease.id, {
      lease_token: session.lease.lease_token,
    }, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    clearPgEditLeaseSession(store, entityType, recordId);
    return true;
  } catch (error) {
    if (options.reportError && store) store.error = error?.message || 'Unable to release Tower PG edit lease.';
    return false;
  }
}

export function addPgEditLeaseToSaveBody(store, record, entityType, body = {}) {
  if (!isSyncedPgRecord(record)) return body;
  const session = getPgEditLeaseSession(store, entityType, record?.record_id);
  const leaseToken = trimText(session?.lease?.lease_token || store?.getPgEditLeaseToken?.(entityType, record?.record_id));
  return leaseToken ? { ...body, lease_token: leaseToken } : body;
}
