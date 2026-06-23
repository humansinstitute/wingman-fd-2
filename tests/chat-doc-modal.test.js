import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('chat document modal wiring', () => {
  it('renders the docs editor as an inline overlay instead of an iframe app', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(html).toContain("navSection === 'docs' || $store.chat.chatDocModalOpen");
    expect(html).toContain('chat-doc-page-backdrop');
    expect(html).toContain('chat-doc-inline-section');
    expect(html).toContain('chat-doc-modal-fullscreen');
    expect(html).toContain('$store.chat.toggleChatDocModalFullScreen()');
    expect(html).toContain('$store.chat.closeChatDocModal()');
    expect(html).not.toContain('chat-doc-modal-frame');
    expect(html).not.toContain('<iframe');
    expect(css).toContain('width: min(88vw, 1120px)');
    expect(css).toContain('border: 0');
    expect(css).toContain('.chat-doc-page-backdrop');
    expect(css).toContain('background: rgba(15, 23, 42, 0.42)');
    expect(css).toContain('backdrop-filter: blur(10px)');
    expect(css).toContain('.docs-section.chat-doc-inline-section.chat-doc-modal-fullscreen');
  });

  it('keeps the inline doc and comments scrollable inside the modal shell', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.docs-section.chat-doc-inline-section .doc-preview-surface');
    expect(css).toContain('overscroll-behavior: contain');
    expect(css).toContain('.docs-section.chat-doc-inline-section .doc-source-editor');
    expect(css).toContain('resize: none');
  });

  it('routes chat doc mentions into the modal instead of normal docs navigation', () => {
    const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

    expect(source).toMatch(/if \(this\.navSection === 'chat'\) \{\s*this\.openChatDocModal\(id\);/);
    expect(source).toContain('openChatDocModal(recordId');
    expect(source).toContain("this.createOptimisticChatDoc(docId, options.title)");
    expect(source).not.toContain("await hydrateTowerPgDoc(this, docId)");
    expect(source).toContain('navigate: false');
    expect(source).toContain('ensureSync: false');
    expect(source).toContain('allowCommentBackfill: false');
  });

  it('prefetches doc mention cards before click without blocking modal open', () => {
    const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

    expect(source).toContain("document.addEventListener('pointerover'");
    expect(source).toContain("document.addEventListener('focusin'");
    expect(source).toContain('this.prefetchFlightDeckDoc(link.dataset.mentionId)');
    expect(source).toContain('docHydrationInFlightById');
    expect(source).toContain("content_storage_status: 'loading'");
  });

  it('intercepts same-origin docs links in chat before they open a new window', () => {
    const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

    expect(source).toContain("route?.section === 'docs'");
    expect(source).toContain('this.openChatDocModal(route.params.docid');
    expect(source).toContain('routeUrl.origin === window.location.origin');
  });

  it('resets chat doc fullscreen state across modal lifecycle', () => {
    const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    const start = source.indexOf('async openChatDocModal(recordId, options = {})');
    const end = source.indexOf('async deleteCurrentDirectory()', start);
    const methods = source.slice(start, end);

    expect(methods).toContain('this.chatDocModalFullScreen = false');
    expect(methods).toContain('toggleChatDocModalFullScreen()');
    expect(methods).toContain('this.chatDocModalFullScreen = !this.chatDocModalFullScreen');
  });
});
