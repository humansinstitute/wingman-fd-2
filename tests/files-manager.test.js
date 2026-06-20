import { describe, expect, it } from 'vitest';

import {
  buildFileUploadQueueItem,
  buildFileBrowserRows,
  filterFileBrowserRows,
  filesManagerMixin,
} from '../src/files-manager.js';
import { recordFamilyHash } from '../src/translators/chat.js';

describe('files manager', () => {
  const store = {
    documents: [
      {
        record_id: 'doc-1',
        title: 'Launch notes',
        content: '![Diagram](storage://img-doc-1)',
        content_storage_object_id: 'doc-content-1',
        content_storage_content_type: 'application/json',
        content_size_bytes: 1200,
        scope_id: 'scope-1',
        updated_at: '2026-05-01T10:00:00.000Z',
      },
    ],
    tasks: [
      {
        record_id: 'task-1',
        title: 'Prep deck',
        description: 'See ![Mockup](storage://img-task-1)',
        scope_id: 'scope-2',
        updated_at: '2026-05-02T10:00:00.000Z',
      },
    ],
    channels: [
      { record_id: 'chan-1', title: 'Design' },
    ],
    fileMessages: [
      {
        record_id: 'msg-1',
        channel_id: 'chan-1',
        pg_thread_id: 'thread-1',
        body: 'Shared ![Chat image](storage://img-chat-1) and [OS Partner Ecosystem Model Notes.pages](storage://file-chat-1)',
        updated_at: '2026-05-03T10:00:00.000Z',
      },
    ],
    fileComments: [
      {
        record_id: 'comment-1',
        target_record_id: 'doc-1',
        target_record_family_hash: recordFamilyHash('document'),
        body: 'Comment image ![Comment image](storage://img-comment-1)',
        updated_at: '2026-05-04T10:00:00.000Z',
      },
    ],
    audioNotes: [
      {
        record_id: 'audio-1',
        title: 'Voice note',
        storage_object_id: 'audio-obj-1',
        target_record_id: 'msg-1',
        target_record_family_hash: recordFamilyHash('chat_message'),
        mime_type: 'audio/webm',
        size_bytes: 24000,
        updated_at: '2026-05-05T10:00:00.000Z',
      },
    ],
  };

  it('builds file rows from documents, markdown storage refs, chat, comments, and audio notes', () => {
    const rows = buildFileBrowserRows(store);
    const objectIds = rows.map((row) => row.object_id);

    expect(objectIds).toContain('doc-content-1');
    expect(objectIds).toContain('img-doc-1');
    expect(objectIds).toContain('img-task-1');
    expect(objectIds).toContain('img-chat-1');
    expect(objectIds).toContain('file-chat-1');
    expect(objectIds).toContain('img-comment-1');
    expect(objectIds).toContain('audio-obj-1');
    expect(rows.find((row) => row.object_id === 'img-chat-1')).toMatchObject({
      kind: 'image',
      name: 'Chat image',
      source_type: 'chat',
      channel_id: 'chan-1',
    });
    expect(rows.find((row) => row.object_id === 'file-chat-1')).toMatchObject({
      kind: 'file',
      name: 'OS Partner Ecosystem Model Notes.pages',
      source_type: 'chat',
      channel_id: 'chan-1',
    });
    expect(rows.find((row) => row.object_id === 'audio-obj-1')).toMatchObject({
      kind: 'audio',
      channel_id: 'chan-1',
    });
  });

  it('filters rows by source, type, scope, channel, and search query', () => {
    const rows = buildFileBrowserRows(store);

    expect(filterFileBrowserRows(rows, { type: 'audio' })).toHaveLength(1);
    expect(filterFileBrowserRows(rows, { source: 'task' }).map((row) => row.object_id)).toEqual(['img-task-1']);
    expect(filterFileBrowserRows(rows, { scopeId: 'scope-1' }).map((row) => row.object_id).sort()).toEqual([
      'doc-content-1',
      'img-comment-1',
      'img-doc-1',
    ]);
    expect(filterFileBrowserRows(rows, { channelId: 'chan-1' }).map((row) => row.object_id).sort()).toEqual([
      'audio-obj-1',
      'file-chat-1',
      'img-chat-1',
    ]);
    expect(filterFileBrowserRows(rows, { type: 'file' }).map((row) => row.object_id)).toEqual(['file-chat-1']);
    expect(filterFileBrowserRows(rows, { query: 'mockup' }).map((row) => row.object_id)).toEqual(['img-task-1']);
  });

  it('carries PG thread context into file rows', () => {
    const rows = buildFileBrowserRows(store);

    expect(filterFileBrowserRows(rows, { contextChannelId: 'chan-1', contextThreadId: 'thread-1' }).map((row) => row.object_id).sort()).toEqual([
      'audio-obj-1',
      'file-chat-1',
      'img-chat-1',
    ]);
  });

  it('builds upload queue items from browser files', () => {
    const item = buildFileUploadQueueItem({
      name: 'Plan.pdf',
      type: 'application/pdf',
      size: 4096,
    }, { scopeId: 'scope-1' });

    expect(item).toMatchObject({
      original_name: 'Plan.pdf',
      name: 'Plan.pdf',
      scope_id: 'scope-1',
      status: 'queued',
      progress: 0,
      size_bytes: 4096,
      content_type: 'application/pdf',
    });
    expect(item.id).toBeTruthy();
  });

  it('opens editable metadata for PG-backed file rows', () => {
    const fileRow = {
      source_type: 'document',
      source_record_id: 'file-1',
      name: 'Original.pdf',
      scope_id: 'scope-1',
      channel_id: 'chan-1',
      object_id: 'storage-1',
    };
    const editStore = Object.assign(Object.create(filesManagerMixin), {
      isTowerPgMode: true,
      documents: [{
        record_id: 'file-1',
        title: 'Original.pdf',
        pg_backend: true,
        pg_record_type: 'file',
        pg_storage_object_id: 'storage-1',
        scope_id: 'scope-1',
        pg_channel_id: 'chan-1',
      }],
      channels: [
        { record_id: 'chan-1', title: 'General', scope_id: 'scope-1', record_state: 'active' },
        { record_id: 'chan-2', title: 'Finance', scope_id: 'scope-2', record_state: 'active' },
      ],
      taskBoards: [
        { id: 'scope-1', label: 'Home', zoom: 'scope' },
        { id: 'scope-2', label: 'Finance', zoom: 'scope' },
      ],
      getChannelLabel(channel) {
        return channel.title;
      },
    });

    editStore.openFileEditModal(fileRow);

    expect(editStore.showFileEditModal).toBe(true);
    expect(editStore.fileEditName).toBe('Original.pdf');
    expect(editStore.fileEditScopeId).toBe('scope-1');
    expect(editStore.fileEditChannelId).toBe('chan-1');
    expect(editStore.fileEditContextChanged).toBe(false);

    editStore.selectFileEditScope('scope-2');

    expect(editStore.fileEditChannelId).toBe('chan-2');
    expect(editStore.fileEditContextChanged).toBe(true);
  });

  it('does not report file edit context changes when no file is being edited', () => {
    const editStore = Object.assign(Object.create(filesManagerMixin), {
      fileEditRow: null,
      documents: [null],
      fileEditScopeId: 'scope-1',
      fileEditChannelId: 'chan-1',
    });

    expect(editStore.fileEditContextChanged).toBe(false);
  });
});
