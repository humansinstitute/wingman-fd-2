import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/disabled-surfaces.js', () => ({
  blockDisabledFlightDeckSurface: vi.fn(() => false),
}));

vi.mock('../src/db.js', () => ({
  addPendingWrite: vi.fn(async () => {}),
  upsertReport: vi.fn(async () => {}),
}));

vi.mock('../src/translators/reports.js', () => ({
  outboundReport: vi.fn(async (payload) => ({
    ...payload,
    record_family_hash: 'mock:report',
    owner_payload: { ciphertext: '{}' },
    group_payloads: [],
  })),
}));

vi.mock('../src/preferred-write-group.js', () => ({
  getRecordWriteFieldsForStore: vi.fn(async () => ({
    group_ids: ['group-1'],
    write_group_ref: 'group-1',
  })),
}));

import { addPendingWrite, upsertReport } from '../src/db.js';
import { getRecordWriteFieldsForStore } from '../src/preferred-write-group.js';
import { outboundReport } from '../src/translators/reports.js';
import { buildDeletedReportRow, reportsManagerMixin } from '../src/reports-manager.js';

function createReport(overrides = {}) {
  return {
    record_id: 'report-1',
    owner_npub: 'npub_owner',
    title: 'Daily Users',
    generated_at: '2026-05-14T09:00:00.000Z',
    updated_at: '2026-05-14T09:05:00.000Z',
    version: 3,
    record_state: 'active',
    sync_status: 'synced',
    group_ids: ['group-1'],
    metadata: {
      title: 'Daily Users',
      generated_at: '2026-05-14T09:00:00.000Z',
      record_state: 'active',
      surface: 'flightdeck',
      scope: { id: 'scope-1' },
    },
    declaration_type: 'metric',
    payload: { label: 'Users', value: 12 },
    ...overrides,
  };
}

function createStore(overrides = {}) {
  const store = {
    session: { npub: 'npub_viewer' },
    signingNpub: 'npub_signer',
    reports: [createReport(), createReport({ record_id: 'report-2', title: 'Revenue' })],
    selectedReportId: 'report-1',
    reportModalReport: null,
    reportActionsMenuId: '',
    reportDeleteConfirmReport: null,
    reportDeleteSubmitting: false,
    reportDeleteError: '',
    error: '',
    flushAndBackgroundSync: vi.fn(async () => ({ pushed: 1 })),
    get scopedReports() {
      return this.reports.filter((report) => report.record_state !== 'deleted');
    },
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(reportsManagerMixin);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, descriptor);
  }
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildDeletedReportRow', () => {
  it('marks reports as deleted without discarding report metadata', () => {
    const deleted = buildDeletedReportRow(createReport(), '2026-05-14T10:00:00.000Z');

    expect(deleted.record_state).toBe('deleted');
    expect(deleted.metadata.record_state).toBe('deleted');
    expect(deleted.metadata.scope.id).toBe('scope-1');
    expect(deleted.version).toBe(4);
    expect(deleted.updated_at).toBe('2026-05-14T10:00:00.000Z');
  });
});

describe('reportsManagerMixin', () => {
  it('opens and cancels delete confirmation without mutating persisted reports', () => {
    const store = createStore();

    store.toggleReportActionsMenu('report-1');
    expect(store.isReportActionsMenuOpen('report-1')).toBe(true);

    store.openReportDeleteConfirm(store.reports[0]);
    expect(store.reportDeleteConfirmReport.record_id).toBe('report-1');
    expect(store.reportActionsMenuId).toBe('');

    store.closeReportDeleteConfirm();

    expect(store.reportDeleteConfirmReport).toBeNull();
    expect(store.reports).toHaveLength(2);
    expect(upsertReport).not.toHaveBeenCalled();
    expect(addPendingWrite).not.toHaveBeenCalled();
  });

  it('queues a tombstone write and removes a confirmed report from visible state', async () => {
    const store = createStore({ reportModalReport: createReport() });
    store.openReportDeleteConfirm(store.reports[0]);

    const result = await store.confirmDeleteReport();

    expect(result.record_id).toBe('report-1');
    expect(result.record_state).toBe('deleted');
    expect(upsertReport).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'report-1',
      record_state: 'deleted',
      version: 4,
    }));
    expect(getRecordWriteFieldsForStore).toHaveBeenCalledWith(store, expect.objectContaining({
      record_id: 'report-1',
      record_state: 'deleted',
    }), { label: 'Report delete' });
    expect(outboundReport).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'report-1',
      previous_version: 3,
      record_state: 'deleted',
      signature_npub: 'npub_signer',
      write_group_ref: 'group-1',
    }));
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'report-1',
      record_family_hash: 'mock:report',
    }));
    expect(store.reports.map((report) => report.record_id)).toEqual(['report-2']);
    expect(store.selectedReportId).toBe('report-2');
    expect(store.reportModalReport).toBeNull();
    expect(store.reportDeleteConfirmReport).toBeNull();
    expect(store.flushAndBackgroundSync).toHaveBeenCalledTimes(1);
  });

  it('surfaces failures and restores the local row when queueing fails', async () => {
    vi.mocked(addPendingWrite).mockRejectedValueOnce(new Error('queue failed'));
    const originalReport = createReport();
    const store = createStore({ reports: [originalReport] });
    store.openReportDeleteConfirm(originalReport);

    const result = await store.confirmDeleteReport();

    expect(result).toBeNull();
    expect(upsertReport).toHaveBeenNthCalledWith(1, expect.objectContaining({
      record_id: 'report-1',
      record_state: 'deleted',
    }));
    expect(upsertReport).toHaveBeenNthCalledWith(2, originalReport);
    expect(store.reports).toEqual([originalReport]);
    expect(store.reportDeleteConfirmReport).toBe(originalReport);
    expect(store.reportDeleteError).toBe('queue failed');
    expect(store.error).toBe('queue failed');
    expect(store.flushAndBackgroundSync).not.toHaveBeenCalled();
  });
});
