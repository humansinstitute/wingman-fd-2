import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readProjectFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('task assignment UI wiring', () => {
  it('uses the current PG actor npub for assigned-to-me filtering when available', () => {
    const source = readProjectFile('src/app.js');
    const html = readProjectFile('index.html');

    expect(source).toContain('get currentPgActorNpub()');
    expect(source).toContain('get currentViewerNpub()');
    expect(source).toContain('this.taskFilterAssignee = this.currentViewerNpub || null;');
    expect(html).toContain('$store.chat.getSenderAvatar($store.chat.currentViewerNpub)');
  });

  it('normalizes scalar and array task assignee rows for display helpers', () => {
    const source = readProjectFile('src/app.js');

    expect(source).toContain('getTaskAssigneeNpubs(task) {');
    expect(source).toContain('return normalizeTaskAssigneeNpubs(task);');
    expect(source).toContain('const assigned_to_npubs = normalizeTaskAssigneeNpubs(npubs);');
  });
});
