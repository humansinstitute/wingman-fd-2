import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(relativePath) {
  return readFileSync(resolve(import.meta.dirname, '..', relativePath), 'utf8');
}

function extractRule(css, selector) {
  const selectorIndex = css.indexOf(selector);
  expect(selectorIndex, `missing selector ${selector}`).toBeGreaterThanOrEqual(0);
  const blockStart = css.indexOf('{', selectorIndex);
  let depth = 1;
  let index = blockStart + 1;
  while (index < css.length && depth > 0) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    index += 1;
  }
  return css.slice(blockStart + 1, index - 1);
}

describe('task comments panel fullscreen affordance', () => {
  it('renders one task activity fullscreen button without the old resize affordance', () => {
    const html = readProjectFile('index.html');

    expect(html).toContain('task-comments-fullscreen-btn');
    expect(html).toContain('$store.chat.openTaskCommentsFullscreen()');
    expect(html).toContain('aria-label="Open activity fullscreen"');
    expect(html).not.toContain('task-comments-resize-btn');
    expect(html).not.toContain('taskCommentsPanelExpanded');
    expect(html).not.toContain('toggleTaskCommentsPanelExpanded');
    expect(html).not.toContain('task-detail-body-comments-expanded');
    expect(html).not.toContain('task-comments-section-expanded');
    expect(html).not.toContain('task-detail-activity-sidebar');
    expect(html).not.toContain('task-comments-panel-rail');
    expect(html).toContain('id="task-comments-panel"');

    const mainIndex = html.indexOf('class="task-detail-main"');
    const commentsIndex = html.indexOf('id="task-comments-panel"');
    expect(mainIndex).toBeGreaterThanOrEqual(0);
    expect(commentsIndex).toBeGreaterThan(mainIndex);
  });

  it('defines fullscreen store state and detail lifecycle reset', () => {
    const appSource = readProjectFile('src/app.js');
    const taskDetailSource = readProjectFile('src/task-detail-manager.js');

    expect(appSource).toMatch(/taskCommentsFullscreenOpen:\s*false/);
    expect(appSource).toContain('taskDetailManagerMixin');
    expect(taskDetailSource).not.toContain('taskCommentsPanelExpanded');
    expect(taskDetailSource).not.toContain('toggleTaskCommentsPanelExpanded');
    expect(taskDetailSource).toContain('openTaskCommentsFullscreen()');
    expect(taskDetailSource).toContain('closeTaskCommentsFullscreen()');
    expect(taskDetailSource).toContain('normalizeTaskComments(comments)');

    const openTaskDetail = taskDetailSource.slice(taskDetailSource.indexOf('openTaskDetail(taskId'), taskDetailSource.indexOf('async closeTaskDetail'));
    expect(openTaskDetail).toContain('this.taskCommentsFullscreenOpen = false;');

    const closeTaskDetail = taskDetailSource.slice(taskDetailSource.indexOf('async closeTaskDetail'), taskDetailSource.indexOf('openTaskCommentsFullscreen()'));
    expect(closeTaskDetail).toContain('this.taskCommentsFullscreenOpen = false;');
  });

  it('renders a fullscreen activity reader for long comments', () => {
    const html = readProjectFile('index.html');

    expect(html).toContain('task-comments-fullscreen-backdrop');
    expect(html).toContain('task-comments-fullscreen-modal');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('@keydown.escape.window="$store.chat.closeTaskCommentsFullscreen()"');
    expect(html).toContain('task-comment-fullscreen-body');
    expect(html).toContain('x-html="$store.chat.renderMarkdown(comment.body)"');
  });

  it('keeps the baseline task comments layout and mobile fullscreen modal', () => {
    const css = readProjectFile('src/styles.css');

    const bodyRule = extractRule(css, '\n.task-detail-body');
    expect(bodyRule).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*minmax\(20rem,\s*25rem\)/);
    expect(css).not.toContain('task-detail-body-comments-expanded');
    expect(css).not.toContain('task-comments-resize-btn');
    expect(css).not.toContain('task-detail-activity-sidebar');
    expect(css).not.toContain('task-comments-panel-rail');

    const mobileStart = css.lastIndexOf('@media (max-width: 768px)');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobileCss = css.slice(mobileStart);
    const mobileFullscreenRule = extractRule(mobileCss, '.task-comments-fullscreen-modal');
    expect(mobileFullscreenRule).toMatch(/height\s*:\s*100%/);
    expect(mobileFullscreenRule).toMatch(/border-radius\s*:\s*0/);
  });
});
