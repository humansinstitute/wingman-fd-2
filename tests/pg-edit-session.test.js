import { describe, expect, it, vi } from 'vitest';
import {
  acquirePgEditLeaseForRecord,
  releasePgEditLeaseForRecord,
  PG_EDIT_CONFLICT_MESSAGE,
  PG_SYNCED_OFFLINE_EDIT_MESSAGE,
  preparePgSyncedRecordMutation,
  startPgEditLeaseRenewal,
  stopPgEditLeaseRenewal,
} from '../src/pg-edit-session.js';

vi.mock('../src/api.js', () => ({
  acquireTowerPgEditLease: vi.fn(),
  releaseTowerPgEditLease: vi.fn(),
  renewTowerPgEditLease: vi.fn(),
}));

function store(seed = {}) {
  return {
    backendUrl: 'https://tower.example',
    workspaceOwnerNpub: 'npub1owner',
    currentWorkspace: {
      workspaceId: 'workspace-1',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      pgBackendMode: true,
    },
    pgEditLeaseSessions: {},
    ...seed,
  };
}

describe('PG edit sessions', () => {
  it('blocks synced PG edit entry while offline', async () => {
    await expect(acquirePgEditLeaseForRecord(store(), {
      record_id: 'task-1',
      pg_backend: true,
      sync_status: 'synced',
    }, 'task', { env: { navigator: { onLine: false } } })).rejects.toMatchObject({
      userMessage: PG_SYNCED_OFFLINE_EDIT_MESSAGE,
    });
  });

  it('allows unsynced local PG records to edit offline without acquiring a lease', async () => {
    const api = await import('../src/api.js');
    const result = await acquirePgEditLeaseForRecord(store(), {
      record_id: 'task-local',
      pg_backend: true,
      sync_status: 'pending',
    }, 'task', { env: { navigator: { onLine: false } } });

    expect(result).toBeNull();
    expect(api.acquireTowerPgEditLease).not.toHaveBeenCalled();
  });

  it('acquires and stores a lease before online synced edits', async () => {
    const api = await import('../src/api.js');
    api.acquireTowerPgEditLease.mockResolvedValueOnce({
      lease: { id: 'lease-1', lease_token: 'token-1' },
    });
    const target = store();

    const lease = await acquirePgEditLeaseForRecord(target, {
      record_id: 'doc-1',
      pg_backend: true,
      sync_status: 'synced',
    }, 'document', { env: { navigator: { onLine: true } } });

    expect(api.acquireTowerPgEditLease).toHaveBeenCalledWith('workspace-1', {
      entity_type: 'document',
      entity_id: 'doc-1',
      ttl_seconds: 120,
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(lease).toEqual({ id: 'lease-1', lease_token: 'token-1' });
    expect(target.pgEditLeaseSessions['document:doc-1'].lease.lease_token).toBe('token-1');
  });

  it('maps lease conflicts to a view-mode message', async () => {
    const api = await import('../src/api.js');
    const conflict = new Error('Tower PG API 409');
    conflict.status = 409;
    api.acquireTowerPgEditLease.mockRejectedValueOnce(conflict);
    const target = store();

    await expect(acquirePgEditLeaseForRecord(target, {
      record_id: 'task-1',
      pg_backend: true,
      sync_status: 'synced',
    }, 'task', { env: { navigator: { onLine: true } } })).rejects.toMatchObject({
      userMessage: PG_EDIT_CONFLICT_MESSAGE,
    });
    expect(target.pgEditLeaseSessions['task:task-1'].message).toBe(PG_EDIT_CONFLICT_MESSAGE);
  });

  it('prepares online synced task mutations by acquiring a PG lease', async () => {
    const api = await import('../src/api.js');
    api.acquireTowerPgEditLease.mockResolvedValueOnce({
      lease: { id: 'lease-task-1', lease_token: 'task-token-1' },
    });
    const target = store();

    const lease = await preparePgSyncedRecordMutation(target, {
      record_id: 'task-1',
      pg_backend: true,
      sync_status: 'synced',
    }, 'task', { env: { navigator: { onLine: true } } });

    expect(api.acquireTowerPgEditLease).toHaveBeenCalledWith('workspace-1', {
      entity_type: 'task',
      entity_id: 'task-1',
      ttl_seconds: 120,
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(lease).toEqual({ id: 'lease-task-1', lease_token: 'task-token-1' });
    expect(target.pgEditLeaseSessions['task:task-1'].lease.lease_token).toBe('task-token-1');
  });

  it('blocks offline synced task mutations before local writes can be staged', async () => {
    const api = await import('../src/api.js');
    api.acquireTowerPgEditLease.mockClear();
    await expect(preparePgSyncedRecordMutation(store(), {
      record_id: 'task-1',
      pg_backend: true,
      sync_status: 'synced',
    }, 'task', { env: { navigator: { onLine: false } } })).rejects.toMatchObject({
      userMessage: PG_SYNCED_OFFLINE_EDIT_MESSAGE,
    });
    expect(api.acquireTowerPgEditLease).not.toHaveBeenCalled();
  });

  it('renews held leases on a scoped timer and stops cleanly', async () => {
    const api = await import('../src/api.js');
    api.renewTowerPgEditLease.mockResolvedValueOnce({
      lease: { id: 'lease-1', lease_token: 'token-2' },
    });
    const callbacks = [];
    const setInterval = vi.fn((callback) => {
      callbacks.push(callback);
      return 'timer-1';
    });
    const clearInterval = vi.fn();
    const target = store({
      pgEditLeaseSessions: {
        'task:task-1': { lease: { id: 'lease-1', lease_token: 'token-1' } },
      },
    });
    const record = { record_id: 'task-1', pg_backend: true, sync_status: 'synced' };

    const timer = startPgEditLeaseRenewal(target, record, 'task', { intervalMs: 2_000, setInterval, clearInterval });

    expect(timer).toBe('timer-1');
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 2_000);
    await callbacks[0]();
    expect(api.renewTowerPgEditLease).toHaveBeenCalledWith('workspace-1', 'lease-1', {
      lease_token: 'token-1',
      ttl_seconds: 120,
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(target.pgEditLeaseSessions['task:task-1'].lease.lease_token).toBe('token-2');

    expect(stopPgEditLeaseRenewal(target, record, 'task', { clearInterval })).toBe(true);
    expect(clearInterval).toHaveBeenCalledWith('timer-1');
    expect(target.pgEditLeaseRenewalTimers['task:task-1']).toBeUndefined();
  });

  it('stops renewal and clears the local session when releasing a PG edit lease', async () => {
    const api = await import('../src/api.js');
    api.releaseTowerPgEditLease.mockResolvedValueOnce({ released: true });
    const clearInterval = vi.fn();
    const target = store({
      pgEditLeaseSessions: {
        'document:doc-1': { lease: { id: 'lease-doc-1', lease_token: 'doc-token-1' } },
      },
      pgEditLeaseRenewalTimers: {
        'document:doc-1': 'timer-doc-1',
      },
    });
    const record = { record_id: 'doc-1', pg_backend: true, sync_status: 'synced' };

    const released = await releasePgEditLeaseForRecord(target, record, 'document', { clearInterval });

    expect(released).toBe(true);
    expect(clearInterval).toHaveBeenCalledWith('timer-doc-1');
    expect(api.releaseTowerPgEditLease).toHaveBeenCalledWith('workspace-1', 'lease-doc-1', {
      lease_token: 'doc-token-1',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(target.pgEditLeaseSessions['document:doc-1']).toBeUndefined();
    expect(target.pgEditLeaseRenewalTimers['document:doc-1']).toBeUndefined();
  });
});
