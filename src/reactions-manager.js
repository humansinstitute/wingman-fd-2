import {
  addPendingWrite,
  getChannelById,
  getCommentById,
  getDocumentById,
  getMessageById,
  getReactionByIdentity,
  getReactionsByTargets,
  getTaskById,
  upsertReaction,
} from './db.js';
import {
  createTowerPgReaction,
  deleteTowerPgReaction,
  getTowerPgReactions,
} from './api.js';
import { outboundReaction } from './translators/reactions.js';
import { recordFamilyHash } from './translators/chat.js';
import { recordFamilyHash as taskFamilyHash } from './translators/tasks.js';
import {
  DEFAULT_REACTION_EMOJI,
  REACTION_EMOJI_OPTIONS,
  getReactionLabel,
  normalizeReactionEmoji,
  summarizeReactions,
} from './reactions.js';
import { getRecordWriteFieldsForStore } from './preferred-write-group.js';
import { toRaw } from './utils/state-helpers.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import { resolveTowerPgWorkspaceContext } from './pg-read-hydrator.js';

function targetKey(targetRecordFamilyHash, targetRecordId) {
  return `${String(targetRecordFamilyHash || '').trim()}::${String(targetRecordId || '').trim()}`;
}

function sameReactionList(left = [], right = []) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] || {};
    const b = right[index] || {};
    if ([
      'record_id',
      'target_record_id',
      'target_record_family_hash',
      'emoji',
      'reactor_npub',
      'record_state',
      'version',
      'updated_at',
    ].some((key) => String(a[key] ?? '') !== String(b[key] ?? ''))) return false;
  }
  return true;
}

function requireReactionTargetGroupIds(writeFields) {
  const rawGroupIds = toRaw(writeFields?.target_group_ids);
  const targetGroupIds = Array.isArray(rawGroupIds)
    ? [...new Set(rawGroupIds.map((value) => String(value || '').trim()).filter(Boolean))]
    : [];
  if (targetGroupIds.length === 0) {
    throw new Error('Reaction write is missing target group keys.');
  }
  return {
    ...writeFields,
    target_group_ids: targetGroupIds,
  };
}

async function resolvePgReactionTarget(targetId, familyHash) {
  if (familyHash === recordFamilyHash('chat_message')) return { target_type: 'message', target_id: targetId };
  if (familyHash === taskFamilyHash('task')) return { target_type: 'task', target_id: targetId };
  if (familyHash === recordFamilyHash('comment')) {
    const comment = await getCommentById(targetId);
    if (comment?.pg_record_type === 'task_comment') return { target_type: 'task_comment', target_id: targetId };
  }
  return null;
}

export const reactionsManagerMixin = {
  get reactionEmojiOptions() {
    return REACTION_EMOJI_OPTIONS;
  },

  reactionTargetFamilyHash(collectionSpace) {
    return recordFamilyHash(collectionSpace);
  },

  reactionLabel(emoji) {
    return getReactionLabel(emoji);
  },

  reactionPickerKey(targetRecordFamilyHash, targetRecordId) {
    return targetKey(targetRecordFamilyHash, targetRecordId);
  },

  isReactionPickerOpen(targetRecordFamilyHash, targetRecordId) {
    return this.reactionPickerTargetKey === this.reactionPickerKey(targetRecordFamilyHash, targetRecordId);
  },

  toggleReactionPicker(targetRecordFamilyHash, targetRecordId) {
    const key = this.reactionPickerKey(targetRecordFamilyHash, targetRecordId);
    this.reactionPickerTargetKey = this.reactionPickerTargetKey === key ? '' : key;
  },

  closeReactionPicker() {
    this.reactionPickerTargetKey = '';
  },

  applyReactions(reactions = []) {
    const nextReactions = (Array.isArray(reactions) ? reactions : [])
      .slice()
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    if (!sameReactionList(this.reactionRows, nextReactions)) {
      this.reactionRows = nextReactions;
    }

    const reactorNpubs = [...new Set(nextReactions
      .map((reaction) => reaction.reactor_npub || reaction.sender_npub)
      .filter(Boolean))];
    if (typeof this.resolveChatProfile === 'function') {
      reactorNpubs.forEach((npub) => this.resolveChatProfile(npub));
    }
  },

  patchReactionLocal(nextReaction) {
    const index = this.reactionRows.findIndex((reaction) => reaction.record_id === nextReaction.record_id);
    if (index >= 0) {
      this.reactionRows.splice(index, 1, { ...this.reactionRows[index], ...nextReaction });
      return;
    }
    this.reactionRows = [...this.reactionRows, nextReaction]
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
  },

  getReactionsForTarget(targetRecordId, targetRecordFamilyHash) {
    const targetId = String(targetRecordId || '').trim();
    const familyHash = String(targetRecordFamilyHash || '').trim();
    if (!targetId || !familyHash) return [];
    return this.reactionRows.filter((reaction) =>
      reaction.target_record_id === targetId
      && reaction.target_record_family_hash === familyHash
    );
  },

  getReactionSummary(targetRecordId, targetRecordFamilyHash) {
    return summarizeReactions(
      this.getReactionsForTarget(targetRecordId, targetRecordFamilyHash),
      this.session?.npub,
    );
  },

  async refreshReactionsForVisibleTargets() {
    const chatFamilyHash = recordFamilyHash('chat_message');
    const commentFamilyHash = recordFamilyHash('comment');
    const chatTargetIds = [...new Set((this.messages || [])
      .map((message) => message.record_id)
      .filter(Boolean))];
    const commentTargetIds = [...new Set([
      ...(this.taskComments || []).map((comment) => comment.record_id),
      ...(this.docComments || []).map((comment) => comment.record_id),
    ].filter(Boolean))];

    const [messageReactions, commentReactions] = await Promise.all([
      getReactionsByTargets(chatTargetIds, chatFamilyHash),
      getReactionsByTargets(commentTargetIds, commentFamilyHash),
    ]);
    const pgReactions = [];
    if (isTowerPgBackendMode()) {
      const context = resolveTowerPgWorkspaceContext(this);
      const collectPg = async (targetType, targetId, familyHash) => {
        const result = await getTowerPgReactions(context.workspaceId, {
          targetType,
          targetId,
          baseUrl: context.baseUrl,
          appNpub: context.appNpub,
        });
        for (const reaction of Array.isArray(result?.reactions) ? result.reactions : []) {
          const now = new Date().toISOString();
          pgReactions.push({
            record_id: reaction.id,
            owner_npub: context.workspaceOwnerNpub,
            target_record_id: targetId,
            target_record_family_hash: familyHash,
            emoji: reaction.emoji,
            emoji_shortcode: reaction.emoji_shortcode,
            reactor_npub: reaction.reactor_npub || reaction.reactor_actor_id,
            sender_npub: reaction.reactor_npub || reaction.reactor_actor_id,
            record_state: reaction.record_state || 'active',
            version: Number(reaction.row_version || 1),
            created_at: reaction.created_at || reaction.updated_at || now,
            updated_at: reaction.updated_at || reaction.created_at || now,
            pg_backend: true,
            pg_record_type: 'reaction',
            pg_workspace_id: reaction.workspace_id,
            pg_channel_id: reaction.channel_id,
            pg_thread_id: reaction.thread_id || null,
          });
        }
      };
      await Promise.all([
        ...chatTargetIds.map((targetId) => collectPg('message', targetId, chatFamilyHash)),
        ...(this.tasks || [])
          .filter((task) => task?.pg_backend && task?.record_id)
          .map((task) => collectPg('task', task.record_id, taskFamilyHash('task'))),
        ...(this.taskComments || [])
          .filter((comment) => comment?.pg_backend && comment?.record_id)
          .map((comment) => collectPg('task_comment', comment.record_id, commentFamilyHash)),
      ]);
    }
    this.applyReactions([...messageReactions, ...commentReactions, ...pgReactions]);
  },

  findLocalCommentForReaction(commentId) {
    const id = String(commentId || '').trim();
    if (!id) return null;
    return [
      ...(this.taskComments || []),
      ...(this.docComments || []),
      ...(this.opportunityComments || []),
    ].find((comment) => comment.record_id === id) || null;
  },

  async resolveReactionWriteFields(targetRecordId, targetRecordFamilyHash) {
    const targetId = String(targetRecordId || '').trim();
    const familyHash = String(targetRecordFamilyHash || '').trim();
    if (!targetId || !familyHash) throw new Error('Reaction target is missing.');

    if (familyHash.endsWith(':chat_message')) {
      const message = (this.messages || []).find((item) => item.record_id === targetId)
        || await getMessageById(targetId);
      if (!message?.channel_id) throw new Error('Reaction target message was not found.');
      const channel = (this.channels || []).find((item) => item.record_id === message.channel_id)
        || await getChannelById(message.channel_id);
      if (!channel) throw new Error('Reaction target channel was not found.');
      const fields = await getRecordWriteFieldsForStore(this, channel, {
        label: 'Chat reaction write',
      });
      return {
        owner_npub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        target_group_ids: fields.group_ids,
        write_group_ref: fields.write_group_ref,
      };
    }

    if (familyHash.endsWith(':comment')) {
      const comment = this.findLocalCommentForReaction(targetId) || await getCommentById(targetId);
      if (!comment) throw new Error('Reaction target comment was not found.');
      const commentTargetFamily = String(comment.target_record_family_hash || '').trim();

      if (commentTargetFamily.endsWith(':task')) {
        const task = (this.tasks || []).find((item) => item.record_id === comment.target_record_id)
          || await getTaskById(comment.target_record_id);
        if (!task) throw new Error('Reaction target task was not found.');
        const fields = await this.getTaskWriteFieldsForWrite(task);
        return {
          owner_npub: comment.owner_npub || task.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
          target_group_ids: fields.group_ids,
          write_group_ref: fields.write_group_ref,
        };
      }

      if (commentTargetFamily.endsWith(':document')) {
        const doc = this.selectedDocument?.record_id === comment.target_record_id
          ? this.selectedDocument
          : ((this.documents || []).find((item) => item.record_id === comment.target_record_id)
            || await getDocumentById(comment.target_record_id));
        if (!doc) throw new Error('Reaction target document was not found.');
        const groupIds = await this.getEncryptableDocCommentGroupIdsForWrite(doc);
        if (groupIds == null) throw new Error(this.error || 'Document reaction write is missing group keys.');
        return {
          owner_npub: comment.owner_npub || doc.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
          target_group_ids: toRaw(groupIds),
          write_group_ref: this.getPreferredDocWriteGroupRef(doc),
        };
      }
    }

    throw new Error('Unsupported reaction target.');
  },

  async toggleReaction(targetRecordId, targetRecordFamilyHash, emoji = DEFAULT_REACTION_EMOJI) {
    this.error = null;
    const targetId = String(targetRecordId || '').trim();
    const familyHash = String(targetRecordFamilyHash || '').trim();
    const reactorNpub = String(this.session?.npub || '').trim();
    if (!targetId || !familyHash || !reactorNpub) return;

    try {
      const canonicalEmoji = normalizeReactionEmoji(emoji);
      if (isTowerPgBackendMode()) {
        const target = await resolvePgReactionTarget(targetId, familyHash);
        if (!target) {
          this.error = 'Reactions for this PG record type are not available yet.';
          return;
        }
        const context = resolveTowerPgWorkspaceContext(this);
        const existing = await getReactionByIdentity({
          target_record_family_hash: familyHash,
          target_record_id: targetId,
          emoji: canonicalEmoji,
          reactor_npub: reactorNpub,
        });
        let accepted;
        if (existing?.record_state === 'active' && existing?.pg_backend) {
          const result = await deleteTowerPgReaction(context.workspaceId, existing.record_id, {
            baseUrl: context.baseUrl,
            appNpub: context.appNpub,
          });
          accepted = result.reaction;
        } else {
          const result = await createTowerPgReaction(context.workspaceId, {
            target_type: target.target_type,
            target_id: target.target_id,
            emoji: canonicalEmoji,
          }, {
            baseUrl: context.baseUrl,
            appNpub: context.appNpub,
          });
          accepted = result.reaction;
        }
        const now = new Date().toISOString();
        const reaction = {
          record_id: accepted.id,
          owner_npub: context.workspaceOwnerNpub,
          target_record_id: targetId,
          target_record_family_hash: familyHash,
          emoji: accepted.emoji || canonicalEmoji,
          emoji_shortcode: accepted.emoji_shortcode || REACTION_EMOJI_OPTIONS.find((option) => option.emoji === canonicalEmoji)?.shortcode || ':thumbs_up:',
          reactor_npub: accepted.reactor_npub || reactorNpub,
          sender_npub: accepted.reactor_npub || reactorNpub,
          record_state: accepted.record_state || 'active',
          version: Number(accepted.row_version || existing?.version || 1),
          created_at: accepted.created_at || existing?.created_at || now,
          updated_at: accepted.updated_at || now,
          pg_backend: true,
          pg_record_type: 'reaction',
          pg_workspace_id: accepted.workspace_id,
          pg_channel_id: accepted.channel_id,
          pg_thread_id: accepted.thread_id || null,
        };
        await upsertReaction(reaction);
        this.patchReactionLocal(reaction);
        this.closeReactionPicker();
        return;
      }
      const writeFields = requireReactionTargetGroupIds(
        await this.resolveReactionWriteFields(targetId, familyHash),
      );
      const existing = await getReactionByIdentity({
        target_record_family_hash: familyHash,
        target_record_id: targetId,
        emoji: canonicalEmoji,
        reactor_npub: reactorNpub,
      });
      const previousVersion = Number(existing?.version ?? 0) || 0;
      const nextState = existing?.record_state === 'active' ? 'deleted' : 'active';
      const now = new Date().toISOString();
      const reaction = {
        record_id: existing?.record_id || crypto.randomUUID(),
        owner_npub: writeFields.owner_npub || this.workspaceOwnerNpub || reactorNpub,
        target_record_id: targetId,
        target_record_family_hash: familyHash,
        emoji: canonicalEmoji,
        emoji_shortcode: REACTION_EMOJI_OPTIONS.find((option) => option.emoji === canonicalEmoji)?.shortcode || ':thumbs_up:',
        reactor_npub: reactorNpub,
        sender_npub: this.signingNpub || reactorNpub,
        record_state: nextState,
        version: previousVersion + 1,
        created_at: existing?.created_at || now,
        updated_at: now,
      };

      await upsertReaction(reaction);
      this.patchReactionLocal(reaction);

      const envelope = await outboundReaction({
        ...reaction,
        previous_version: previousVersion,
        target_group_ids: writeFields.target_group_ids,
        write_group_ref: writeFields.write_group_ref,
        signature_npub: this.signingNpub,
      });
      await addPendingWrite({
        record_id: reaction.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      this.closeReactionPicker();
      await this.flushAndBackgroundSync();
    } catch (error) {
      this.error = error?.message || 'Failed to update reaction.';
    }
  },
};
