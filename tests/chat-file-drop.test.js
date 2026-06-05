import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(resolve('src/app.js'), 'utf8');
const indexSource = readFileSync(resolve('index.html'), 'utf8');

describe('chat file drop upload', () => {
  it('wires file drops on both chat composers', () => {
    expect(indexSource).toContain('@drop.prevent="$store.chat.handleChatFileDrop($event, \'message\')"');
    expect(indexSource).toContain('@drop.prevent="$store.chat.handleChatFileDrop($event, \'thread\')"');
  });

  it('uploads dropped files to storage and inserts storage file-card markdown', () => {
    expect(appSource).toContain('async handleChatFileDrop(event, context = \'message\')');
    expect(appSource).toContain('async uploadFileIntoModel(file, event, options = {})');
    expect(appSource).toContain('prepareStorageObject(buildStoragePrepareBody');
    expect(appSource).toContain('uploadStorageObject(prepared, bytes');
    expect(appSource).toContain('completeStorageObject(prepared.object_id');
    expect(appSource).toContain('return `[${safeLabel}](storage://${objectId})`;');
  });

  it('blocks sending while a dropped file upload token is still present', () => {
    expect(appSource).toContain("text.includes('[ Uploading file... ]')");
  });
});
