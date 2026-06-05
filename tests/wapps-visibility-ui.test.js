import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve('index.html'), 'utf8');

describe('WApp visibility setup UI', () => {
  it('adds an admin setup tab for managing WApp visibility', () => {
    expect(html).toContain("settingsTab === 'apps'");
    expect(html).toContain('$store.chat.refreshWapps()');
    expect(html).toContain('$store.chat.saveEditingWappVisibility()');
  });
});
