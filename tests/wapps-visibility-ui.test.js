import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('index.html'), 'utf8');

describe('WApp visibility setup UI', () => {
  it('keeps WApp visibility management hidden while the surface is disabled', () => {
    expect(html).toContain('x-show="false" x-cloak class="settings-tab" :class="{ active: $store.chat.settingsTab === \'apps\' }"');
    expect(html).toContain('<div class="settings-tab-content" x-show="false">');
    expect(html).toContain('$store.chat.refreshWapps()');
    expect(html).toContain('$store.chat.saveEditingWappVisibility()');
  });
});
