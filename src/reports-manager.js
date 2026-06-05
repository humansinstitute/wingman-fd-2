import { addPendingWrite, upsertReport } from './db.js';
import { outboundReport } from './translators/reports.js';
import { getRecordWriteFieldsForStore } from './preferred-write-group.js';
import { toRaw } from './utils/state-helpers.js';

export function buildDeletedReportRow(report, nowIso = new Date().toISOString()) {
  const previousVersion = Number.isFinite(Number(report?.version)) ? Number(report.version) : 1;
  const metadata = report?.metadata && typeof report.metadata === 'object' && !Array.isArray(report.metadata)
    ? report.metadata
    : {};

  return {
    ...report,
    metadata: {
      ...metadata,
      record_state: 'deleted',
    },
    record_state: 'deleted',
    sync_status: 'pending',
    version: previousVersion + 1,
    updated_at: nowIso,
  };
}

export const reportsManagerMixin = {
  isReportActionsMenuOpen(recordId) {
    return Boolean(recordId) && this.reportActionsMenuId === recordId;
  },

  toggleReportActionsMenu(recordId) {
    const nextId = String(recordId || '').trim();
    this.reportActionsMenuId = this.reportActionsMenuId === nextId ? '' : nextId;
  },

  closeReportActionsMenu() {
    this.reportActionsMenuId = '';
  },

  openReportDeleteConfirm(report) {
    if (!report?.record_id) return;
    this.reportDeleteConfirmReport = report;
    this.reportDeleteError = '';
    if (this.reportModalReport?.record_id === report.record_id) {
      this.reportModalReport = null;
    }
    this.closeReportActionsMenu();
  },

  closeReportDeleteConfirm() {
    if (this.reportDeleteSubmitting) return;
    this.reportDeleteConfirmReport = null;
    this.reportDeleteError = '';
  },

  async confirmDeleteReport() {
    const recordId = this.reportDeleteConfirmReport?.record_id;
    if (!recordId) return null;
    return this.deleteReport(recordId);
  },

  async deleteReport(recordId) {
    const targetId = String(recordId || '').trim();
    const report = (this.reports || []).find((item) => item?.record_id === targetId);
    if (!targetId || !report || !this.session?.npub) return null;

    this.reportDeleteSubmitting = true;
    this.reportDeleteError = '';

    const updated = toRaw(buildDeletedReportRow(report));
    let persistedTombstone = false;

    try {
      const writeFields = await getRecordWriteFieldsForStore(this, updated, {
        label: 'Report delete',
      });
      const envelope = await outboundReport({
        ...updated,
        group_ids: writeFields.group_ids,
        previous_version: report.version ?? 1,
        signature_npub: this.signingNpub || this.session?.npub,
        write_group_ref: writeFields.write_group_ref,
      });

      await upsertReport(updated);
      persistedTombstone = true;
      await addPendingWrite({
        record_id: targetId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });

      this.reports = (this.reports || []).filter((item) => item?.record_id !== targetId);
      if (this.selectedReportId === targetId) {
        this.selectedReportId = this.scopedReports?.[0]?.record_id || null;
      }
      if (this.reportModalReport?.record_id === targetId) {
        this.reportModalReport = null;
      }
      this.reportDeleteConfirmReport = null;

      try {
        await this.flushAndBackgroundSync?.();
      } catch (error) {
        this.error = error?.message || 'Report deleted locally; sync will retry.';
      }

      return updated;
    } catch (error) {
      if (persistedTombstone) {
        try {
          await upsertReport(toRaw(report));
        } catch {
          // Keep the original error visible; the local live query will reconcile on refresh.
        }
      }
      const message = error?.message || 'Failed to delete report.';
      this.reportDeleteError = message;
      this.error = message;
      return null;
    } finally {
      this.reportDeleteSubmitting = false;
    }
  },
};
