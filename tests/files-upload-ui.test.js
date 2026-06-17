import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(path.resolve('index.html'), 'utf8');

describe('files upload UI', () => {
  it('exposes a PG files upload button and drag/drop form', () => {
    const filesSectionIndex = html.indexOf('class="files-section"');
    expect(filesSectionIndex).toBeGreaterThan(-1);

    const uploadButtonIndex = html.indexOf('class="files-upload-open-btn"', filesSectionIndex);
    const uploadPanelIndex = html.indexOf('class="files-upload-panel"', filesSectionIndex);
    const filesListIndex = html.indexOf('class="files-list"', filesSectionIndex);

    expect(uploadButtonIndex).toBeGreaterThan(filesSectionIndex);
    expect(uploadPanelIndex).toBeGreaterThan(uploadButtonIndex);
    expect(uploadPanelIndex).toBeLessThan(filesListIndex);
    expect(html).toContain('@drop.prevent="$store.chat.handleFilesPageDrop($event)"');
    expect(html).toContain('@change="$store.chat.handleFileUploadInput($event)"');
    expect(html).toContain('x-model="item.name"');
    expect(html).toContain('x-model="item.scope_id"');
    expect(html).toContain('x-show="$store.chat.canEditFileBrowserRow(row)"');
    expect(html).toContain('@click="$store.chat.openFileEditModal(row)"');
    expect(html).toContain('id="file-edit-title"');
    expect(html).toContain('x-model="$store.chat.fileEditName"');
    expect(html).toContain('x-model="$store.chat.fileEditScopeId"');
    expect(html).toContain('x-model="$store.chat.fileEditChannelId"');
    expect(html).toContain('Changing scope or channel can make this file inaccessible in previous chat threads');
  });
});
