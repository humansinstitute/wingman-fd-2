import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(relativePath) {
  return readFileSync(resolve(import.meta.dirname, '..', relativePath), 'utf8');
}

describe('docs mobile layout', () => {
  it('renders a mobile Docs and Comments switcher inside the document editor', () => {
    const html = readProjectFile('index.html');
    const editorStart = html.indexOf('class="docs-editor-v3"');
    const editorEnd = html.indexOf('<!-- Doc Versioning View -->', editorStart);
    const editor = html.slice(editorStart, editorEnd);

    expect(editor).toContain('class="mobile-detail-switcher doc-mobile-switcher"');
    expect(editor).toContain("aria-label=\"Document sections\"");
    expect(editor).toContain("$store.chat.docMobilePane = 'document'");
    expect(editor).toContain("$store.chat.docCommentsVisible = true; $store.chat.docMobilePane = 'comments'");
    expect(editor).toContain('doc-content-layout-mobile-comments');
  });

  it('keeps document breadcrumbs left and actions right on mobile without wrapping into a second row', () => {
    const css = readProjectFile('src/styles.css');
    const mobileStart = css.indexOf('@media (max-width: 720px)');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobileCss = css.slice(mobileStart, css.indexOf('.doc-content-block', mobileStart));

    expect(mobileCss).toMatch(/\.doc-editor-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;/);
    expect(mobileCss).toMatch(/\.doc-editor-actions\s*\{[\s\S]*max-width:\s*62vw;[\s\S]*margin-left:\s*auto;[\s\S]*overflow-x:\s*auto;[\s\S]*flex-wrap:\s*nowrap;[\s\S]*justify-content:\s*flex-end;/);
    expect(mobileCss).toMatch(/\.doc-editor-breadcrumbs\s*\{[\s\S]*flex-wrap:\s*nowrap;[\s\S]*overflow-x:\s*auto;/);
    expect(mobileCss).not.toMatch(/\.doc-editor-actions\s*\{[\s\S]*width:\s*100%;[\s\S]*justify-content:\s*flex-start;/);
  });

  it('keeps the document editor toolbar sticky while the document body scrolls', () => {
    const css = readProjectFile('src/styles.css');

    expect(css).toMatch(/\.doc-editor-header\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;[\s\S]*z-index:\s*31;/);
  });

  it('uses mobile-only CSS to show either document content or document comments', () => {
    const css = readProjectFile('src/styles.css');
    const mobileStart = css.lastIndexOf('@media (max-width: 768px)');
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    const mobileCss = css.slice(mobileStart);

    expect(mobileCss).toContain('.doc-content-layout:not(.doc-content-layout-mobile-comments) .doc-comment-thread-panel');
    expect(mobileCss).toContain('.doc-content-layout-mobile-comments .doc-preview-surface');
    expect(mobileCss).toContain('.doc-content-layout-mobile-comments .doc-comment-thread-panel');
  });
});
