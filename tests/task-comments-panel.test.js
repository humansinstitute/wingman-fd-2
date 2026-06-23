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

describe('task comments panel resize affordance', () => {
  it('renders the task activity resize button without the vertical rail', () => {
    const html = readProjectFile('index.html');

    expect(html).toContain("'task-detail-body-comments-expanded': $store.chat.taskCommentsPanelExpanded");
    expect(html).toContain('task-comments-resize-btn');
    expect(html).toContain('task-comments-fullscreen-btn');
    expect(html).toContain('$store.chat.openTaskCommentsFullscreen()');
    expect(html).toContain('aria-label="Open activity fullscreen"');
    expect(html).not.toContain('task-detail-activity-sidebar');
    expect(html).not.toContain('task-comments-panel-rail');
    expect(html).toContain('id="task-comments-panel"');
    expect(html).toContain("'task-comments-section-expanded': $store.chat.taskCommentsPanelExpanded");
    expect(html).toContain('$store.chat.toggleTaskCommentsPanelExpanded()');
    expect(html).toContain("aria-label=\"$store.chat.taskCommentsPanelExpanded ? 'Collapse activity panel' : 'Expand activity panel'\"");
    expect(html).toContain("aria-pressed=\"$store.chat.taskCommentsPanelExpanded.toString()\"");

    const mainIndex = html.indexOf('class="task-detail-main"');
    const commentsIndex = html.indexOf('id="task-comments-panel"');
    expect(mainIndex).toBeGreaterThanOrEqual(0);
    expect(commentsIndex).toBeGreaterThan(mainIndex);
  });

  it('defines store state, toggle behavior, and detail lifecycle reset', () => {
    const source = readProjectFile('src/app.js');

    expect(source).toMatch(/taskCommentsPanelExpanded:\s*false/);
    expect(source).toMatch(/taskCommentsFullscreenOpen:\s*false/);
    expect(source).toContain('toggleTaskCommentsPanelExpanded()');
    expect(source).toContain('this.taskCommentsPanelExpanded = !this.taskCommentsPanelExpanded;');
    expect(source).toContain('openTaskCommentsFullscreen()');
    expect(source).toContain('closeTaskCommentsFullscreen()');
    expect(source).toContain('sortCommentsNewestFirst(comments)');

    const openTaskDetail = source.slice(source.indexOf('openTaskDetail(taskId'), source.indexOf('async closeTaskDetail'));
    expect(openTaskDetail).toContain('this.taskCommentsPanelExpanded = false;');
    expect(openTaskDetail).toContain('this.taskCommentsFullscreenOpen = false;');

    const closeTaskDetail = source.slice(source.indexOf('async closeTaskDetail'), source.indexOf('// --- task ↔ flow linkage helpers ---'));
    expect(closeTaskDetail).toContain('this.taskCommentsPanelExpanded = false;');
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

  it('expands desktop task comments to roughly sixty percent while mobile stays single column', () => {
    const css = readProjectFile('src/styles.css');

    const bodyRule = extractRule(css, '\n.task-detail-body');
    expect(bodyRule).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*minmax\(20rem,\s*25rem\)/);

    const expandedRule = extractRule(css, '.task-detail-body-comments-expanded');
    expect(expandedRule).toMatch(/grid-template-columns\s*:\s*minmax\(16rem,\s*2fr\)\s*minmax\(24rem,\s*3fr\)/);
    expect(css).not.toContain('task-detail-activity-sidebar');
    expect(css).not.toContain('task-comments-panel-rail');

    const mobileStart = css.lastIndexOf('@media (max-width: 768px)');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobileCss = css.slice(mobileStart);
    const mobileExpandedRule = extractRule(mobileCss, '.task-detail-body-comments-expanded');
    expect(mobileExpandedRule).toMatch(/grid-template-columns\s*:\s*1fr/);
    const mobileFullscreenRule = extractRule(mobileCss, '.task-comments-fullscreen-modal');
    expect(mobileFullscreenRule).toMatch(/height\s*:\s*100%/);
    expect(mobileFullscreenRule).toMatch(/border-radius\s*:\s*0/);
  });
});
