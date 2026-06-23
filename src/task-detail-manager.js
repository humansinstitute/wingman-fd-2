import { createTowerPgTaskCommentFromLocal } from './pg-write-adapter.js';
import { addPendingWrite, getCommentsByTarget, replaceCommentRecord, upsertComment } from './db.js';
import { hydrateTowerPgTaskComments } from './pg-read-hydrator.js';
import {
  getPgEditLeaseSession,
  isSyncedPgRecord,
  releasePgEditLeaseForRecord,
} from './pg-edit-session.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import { recordFamilyHash } from './translators/chat.js';
import { outboundComment } from './translators/comments.js';
import {
  parseReferencesFromDescription,
  recordFamilyHash as taskFamilyHash,
} from './translators/tasks.js';
import { normalizePredecessorTaskIds } from './task-predecessor-helpers.js';
import {
  isTaskCommentExpanded as hasExpandedTaskComment,
  isTaskCommentTruncated as hasTruncatedTaskComment,
  normalizeTaskComments,
  syncTaskCommentPreviewState as deriveTaskCommentPreviewState,
  toggleTaskCommentExpandedId,
} from './task-comments.js';
import { schedulePreviewMeasurement } from './preview-truncation.js';
import { sameListBySignature, toRaw } from './utils/state-helpers.js';

export const taskDetailManagerMixin = {
  releaseCurrentPgTaskDetailLeaseBeforeSwitch(nextTaskId) {
    if (!isTowerPgBackendMode()) return;
    const previousTaskId = String(this.activeTaskId || this.editingTask?.record_id || '').trim();
    const targetTaskId = String(nextTaskId || '').trim();
    if (!previousTaskId || previousTaskId === targetTaskId) return;
    const previousTask = this.tasks.find(t => t.record_id === previousTaskId)
      || this.editingTask
      || this.taskEditOriginal;
    if (!isSyncedPgRecord(previousTask)) return;
    const session = getPgEditLeaseSession(this, 'task', previousTask.record_id);
    if (!session?.lease?.lease_token) return;
    void releasePgEditLeaseForRecord(this, previousTask, 'task', {
      reportError: false,
      clearLocalBeforeRelease: true,
    }).catch(() => {});
  },

  openTaskDetail(taskId, options = {}) {
    this.releaseCurrentPgTaskDetailLeaseBeforeSwitch(taskId);
    this.activeTaskId = taskId;
    const task = this.tasks.find(t => t.record_id === taskId);
    if (isTowerPgBackendMode() && task?.pg_channel_id && task.pg_channel_id !== this.selectedChannelId) {
      this.selectPgChannelContext?.(task.pg_channel_id);
    }
    this.editingTask = task ? toRaw(task) : null;
    this.taskEditOriginal = this.editingTask ? toRaw(this.editingTask) : null;
    this.taskDetailMode = 'view';
    this.taskDetailSaving = false;
    this.taskDetailCheckoutPending = false;
    this.taskCommentsFullscreenOpen = false;
    this.applyTaskComments([]);
    if (this.editingTask) {
      const hasStoredRefs = Array.isArray(this.editingTask.references) && this.editingTask.references.length > 0;
      if (!hasStoredRefs && this.editingTask.description) {
        this.editingTask.references = parseReferencesFromDescription(this.editingTask.description);
      }
      this.editingTask.predecessor_task_ids = normalizePredecessorTaskIds(
        this.editingTask.predecessor_task_ids || [],
        this.editingTask.record_id,
      );
    }
    for (const npub of this.getTaskAssigneeNpubs(this.editingTask)) {
      this.resolveChatProfile(npub);
    }
    this.taskAssigneeQuery = '';
    this.predecessorTaskQuery = '';
    this.showPredecessorTaskPicker = false;
    this.showTaskDetail = true;
    this.taskDescriptionEditing = false;
    this.newSubtaskTitle = '';
    this.newTaskCommentBody = '';
    this.loadTaskComments(taskId);
    this.scheduleStorageImageHydration();
    this.markTaskRead(taskId);
    if (options.syncRoute !== false) this.syncRoute();
  },

  async closeTaskDetail(options = {}) {
    if (this.isTaskDetailEditing() && options.releaseCheckout !== false) {
      await this.cancelTaskDetailEdit({ reportError: false });
    }
    this.stopTaskCommentsLiveQuery();
    this.showTaskDetail = false;
    this.activeTaskId = null;
    this.editingTask = null;
    this.taskEditOriginal = null;
    this.taskDetailMode = 'view';
    this.taskDetailSaving = false;
    this.taskDetailCheckoutPending = false;
    this.taskAssigneeQuery = '';
    this.predecessorTaskQuery = '';
    this.showPredecessorTaskPicker = false;
    this.taskScopeCascadePending = false;
    this.taskScopeCascadeMessage = '';
    this.taskComments = [];
    this.expandedTaskCommentIds = [];
    this.truncatedTaskCommentIds = [];
    this.taskCommentsFullscreenOpen = false;
    this.showFlowPicker = false;
    if (options.syncRoute !== false) this.syncRoute();
  },

  openTaskCommentsFullscreen() {
    if (!this.editingTask?.record_id) return;
    this.taskCommentsFullscreenOpen = true;
  },

  closeTaskCommentsFullscreen() {
    this.taskCommentsFullscreenOpen = false;
  },

  async loadTaskComments(taskId) {
    const recordId = String(taskId || '').trim();
    if (!recordId) {
      this.applyTaskComments([]);
      return;
    }
    if (isTowerPgBackendMode()) {
      await hydrateTowerPgTaskComments(this, recordId);
      return;
    }
    this.startTaskCommentsLiveQuery();
    const comments = await getCommentsByTarget(recordId);
    if (String(this.activeTaskId || '').trim() !== recordId) return;
    await this.applyTaskComments(comments);
  },

  isTaskCommentExpanded(recordId) {
    return hasExpandedTaskComment(this.expandedTaskCommentIds, recordId);
  },

  isTaskCommentTruncated(recordId) {
    return hasTruncatedTaskComment(this.truncatedTaskCommentIds, recordId);
  },

  toggleTaskCommentExpanded(recordId) {
    if (!recordId) return;
    this.expandedTaskCommentIds = toggleTaskCommentExpandedId(this.expandedTaskCommentIds, recordId);
    this.scheduleTaskCommentPreviewMeasurement();
  },

  syncTaskCommentPreviewState(comments = this.taskComments) {
    const nextState = deriveTaskCommentPreviewState({
      comments,
      expandedIds: this.expandedTaskCommentIds,
      truncatedIds: this.truncatedTaskCommentIds,
    });
    this.expandedTaskCommentIds = nextState.expandedIds;
    this.truncatedTaskCommentIds = nextState.truncatedIds;
  },

  scheduleTaskCommentPreviewMeasurement() {
    schedulePreviewMeasurement({
      getFrameId: () => this.taskCommentPreviewMeasureFrame,
      setFrameId: (frameId) => { this.taskCommentPreviewMeasureFrame = frameId; },
      setTruncatedIds: (ids) => { this.truncatedTaskCommentIds = ids; },
      selector: '[data-task-comment-preview-id]',
      idDatasetKey: 'taskCommentPreviewId',
      maxLinesDatasetKey: 'taskCommentPreviewMaxLines',
      defaultMaxLines: this.TASK_COMMENT_PREVIEW_MAX_LINES,
    });
  },

  async applyTaskComments(comments = []) {
    const nextComments = normalizeTaskComments(comments);
    if (!sameListBySignature(this.taskComments, nextComments, (comment) => [
      String(comment?.record_id || ''),
      String(comment?.updated_at || ''),
      String(comment?.version ?? ''),
      String(comment?.record_state || ''),
    ].join('|'))) {
      this.taskComments = nextComments;
    }

    for (const comment of nextComments) {
      await this.rememberPeople([comment.sender_npub], 'task-comment');
    }
    this.syncTaskCommentPreviewState(nextComments);
    this.scheduleTaskCommentPreviewMeasurement();
    this.scheduleStorageImageHydration();
    if (typeof this.refreshReactionsForVisibleTargets === 'function') {
      this.refreshReactionsForVisibleTargets().catch(() => {});
    }
  },

  async addTaskComment(taskId) {
    const body = String(this.newTaskCommentBody || '').trim();
    const drafts = [...this.taskCommentAudioDrafts];
    if (this.containsInlineImageUploadToken(body)) {
      this.error = 'Wait for image upload to finish.';
      return;
    }
    if ((!body && drafts.length === 0) || !taskId || !this.session?.npub) return;

    const task = this.tasks.find(t => t.record_id === taskId);
    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;
    const pgMode = isTowerPgBackendMode();
    if (pgMode && drafts.length > 0) {
      this.error = 'Audio drafts are not available in Tower PG task comments yet.';
      return;
    }
    let taskWriteFields = null;
    let attachments = [];
    if (!pgMode) {
      taskWriteFields = await this.getTaskWriteFieldsForWrite(task);
      const materialized = await this.materializeAudioDrafts({
        drafts,
        target_record_id: recordId,
        target_record_family_hash: recordFamilyHash('comment'),
        target_group_ids: taskWriteFields.group_ids,
        write_group_ref: taskWriteFields.write_group_ref,
      });
      attachments = materialized.attachments;
    }

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      target_record_id: taskId,
      target_record_family_hash: taskFamilyHash('task'),
      parent_comment_id: null,
      body,
      attachments,
      sender_npub: this.session.npub,
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
      ...(pgMode ? {
        sync_status: 'pending',
        pg_backend: true,
        pg_record_type: 'task_comment',
        pg_channel_id: task?.pg_channel_id || null,
        pg_thread_id: task?.pg_thread_id || null,
      } : {}),
    };

    await upsertComment(localRow);
    this.taskComments = normalizeTaskComments([localRow, ...this.taskComments]);
    this.syncTaskCommentPreviewState();
    this.newTaskCommentBody = '';
    this.taskCommentAudioDrafts = [];
    this.scheduleTaskCommentPreviewMeasurement();
    this.scheduleStorageImageHydration();

    if (pgMode) {
      try {
        const accepted = await createTowerPgTaskCommentFromLocal(this, localRow);
        await replaceCommentRecord(localRow.record_id, accepted);
        this.taskComments = normalizeTaskComments([
          accepted,
          ...this.taskComments.filter((comment) => comment.record_id !== localRow.record_id),
        ]);
        this.scheduleTaskCommentsRefresh(taskId, 'PG task comment create');
      } catch (error) {
        const failed = { ...localRow, sync_status: 'failed', updated_at: new Date().toISOString() };
        await upsertComment(failed);
        this.taskComments = normalizeTaskComments([
          failed,
          ...this.taskComments.filter((comment) => comment.record_id !== localRow.record_id),
        ]);
        this.error = error?.message || 'Failed to sync PG task comment';
      }
      return;
    }

    const envelope = await outboundComment({
      ...localRow,
      target_group_ids: taskWriteFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: taskWriteFields.write_group_ref,
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.flushAndBackgroundSync();
  },
};
