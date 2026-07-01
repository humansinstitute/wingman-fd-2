import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
const css = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');

describe('files upload UI', () => {
  it('exposes a PG files upload button and modal drag/drop form', () => {
    const filesSectionIndex = html.indexOf('class="files-section"');
    expect(filesSectionIndex).toBeGreaterThan(-1);

    const uploadButtonIndex = html.indexOf('class="files-upload-open-btn"', filesSectionIndex);
    const uploadModalIndex = html.indexOf('class="doc-modal-backdrop files-upload-modal-backdrop"', filesSectionIndex);
    const filesListIndex = html.indexOf('class="files-list"', filesSectionIndex);

    expect(uploadButtonIndex).toBeGreaterThan(filesSectionIndex);
    expect(uploadModalIndex).toBeGreaterThan(uploadButtonIndex);
    expect(uploadModalIndex).toBeLessThan(filesListIndex);
    expect(html).toContain('@drop.prevent="$store.chat.handleFilesPageDrop($event)"');
    expect(html).toContain('@change="$store.chat.handleFileUploadInput($event)"');
    expect(html).toContain('@click="$store.chat.closeFileUploadPanel()"');
    expect(html).toContain('Uploads keep running if this modal is closed.');
    expect(html).toContain('files-upload-toast');
    expect(html).toContain('$store.chat.clearFileUploadNotice()');
    expect(html).toContain('@click="$store.chat.createFileFolderFromPrompt()"');
    expect(html).toContain('Select multiple');
    expect(html).toContain('$store.chat.toggleFileSelectionMode()');
    expect(html).toContain('files-selection-bar');
    expect(html).toContain('currentFileFolderBreadcrumbs');
    expect(html).toContain('currentFileChildFolders');
    expect(html).toContain('@dragstart="$store.chat.handleFileRowDragStart(row, $event)"');
    expect(html).toContain('@drop="$store.chat.handleFileFolderDrop(folder, $event)"');
    expect(html).toContain('x-show="$store.chat.fileSelectionMode && $store.chat.canMoveFileBrowserRow(row)"');
    expect(html).toContain('x-model="item.name"');
    expect(html).toContain('x-model="item.scope_id"');
    expect(html).toContain('x-model="item.folder_id"');
    expect(html).toContain('x-show="$store.chat.canEditFileBrowserRow(row)"');
    expect(html).toContain('@click="$store.chat.openFileEditModal(row)"');
    expect(html).toContain('id="file-edit-title"');
    expect(html).toContain('x-model="$store.chat.fileEditName"');
    expect(html).toContain('x-model="$store.chat.fileEditScopeId"');
    expect(html).toContain('x-model="$store.chat.fileEditChannelId"');
    expect(html).toContain('x-model="$store.chat.fileEditFolderId"');
    expect(html).toContain('Changing scope or channel can make this file inaccessible in previous chat threads');
    expect(html).toContain('fileEditProgressText');
    expect(html).toContain('role="status"');
    expect(html).toContain("fileEditAction === 'convert'");
    expect(html).toContain("fileEditAction === 'save'");
    expect(css).toContain('.files-upload-modal-backdrop');
    expect(css).toContain('.files-upload-modal');
    expect(css).toContain('max-height: min(88dvh, 820px)');
    expect(css).toContain('.files-upload-queue');
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('.files-upload-toast');
  });
});
