import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readProjectFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('task board drag and drop', () => {
  it('keeps cards draggable outside manual sort mode', () => {
    const html = readProjectFile('index.html');

    expect(html).toContain(':draggable="col.state !== \'summary\'"');
    expect(html).not.toContain(':draggable="col.state !== \'summary\' && $store.chat.taskSortIsManual"');
    expect(html).toContain('@drop.prevent="col.state !== \'summary\' && $store.chat.handleTaskDrop($event, col.state)"');
  });

  it('moves task state directly when the visible sort is not manual', () => {
    const source = readProjectFile('src/app.js');
    const start = source.indexOf('async handleTaskDrop(e, targetState, targetTaskId = null, position = \'end\')');
    const end = source.indexOf('const reorderPatches = buildTaskBoardReorderPatches', start);
    const preamble = source.slice(start, end);

    expect(preamble).toContain('if (!this.taskSortIsManual)');
    expect(preamble).toContain('await this.applyTaskPatch(taskId, { state: targetState }');
    expect(preamble).toContain('backgroundPg: isTowerPgBackendMode()');
  });
});
