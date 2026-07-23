import { afterEach, describe, expect, it } from 'vitest';

import {
  expandInlineReferenceLinks,
  normalizeDocumentMentionCardLinks,
  normalizeEscapedFileReferences,
  renderMarkdownToHtml,
  resolveMarkdownHref,
} from '../src/markdown.js';

const originalWindow = globalThis.window;

function setWindowHref(href) {
  globalThis.window = {
    location: new URL(href),
  };
}

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

describe('renderMarkdownToHtml', () => {
  it('renders canonical actor mentions as one inline mention pill without a double at-sign', () => {
    const html = renderMarkdownToHtml('Hello @[Rick](mention:person:npub1rick)');

    expect(html).toContain('class="mention-link mention-link-person"');
    expect(html).toContain('data-mention-id="npub1rick"');
    expect(html).toContain('>@Rick</a>');
    expect(html).not.toContain('>@@Rick</a>');
    expect(html).not.toContain('mention:person:npub1rick');
  });

  it('renders richer markdown blocks and safe links', () => {
    const html = renderMarkdownToHtml([
      '# Title',
      '',
      '- item one',
      '- [x] done',
      '',
      '> quoted',
      '',
      '```js',
      'const value = 1;',
      '```',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '[link](https://example.com)',
    ].join('\n'));

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('<table>');
    expect(html).toContain('href="https://example.com/"');
  });

  it('renders storage and remote images', () => {
    const html = renderMarkdownToHtml([
      '![stored](storage://image-1)',
      '![remote](https://example.com/demo.png)',
    ].join('\n'));

    expect(html).toContain('data-storage-object-id="image-1"');
    expect(html).toContain('src="https://example.com/demo.png"');
  });

  it('renders storage links as file cards', () => {
    const html = renderMarkdownToHtml('[Brief.pdf](storage://file-1)');

    expect(html).toContain('class="md-storage-file-card"');
    expect(html).toContain('data-storage-object-id="file-1"');
    expect(html).toContain('data-storage-file-name="Brief.pdf"');
    expect(html).toContain('<strong>Brief.pdf</strong>');
  });

  it('keeps storage images as image previews instead of file cards', () => {
    const html = renderMarkdownToHtml('![Brief image](storage://image-2)');

    expect(html).toContain('class="md-storage-image md-storage-image-pending"');
    expect(html).toContain('data-storage-object-id="image-2"');
    expect(html).not.toContain('md-storage-file-card');
  });

  it('renders local file image references as image previews', () => {
    const href = 'file:///Users/mini/code/wingmanbefree/autopilot/tmp/uploads/images/shot.png';
    const html = renderMarkdownToHtml(`![uploaded image](${href})`);

    expect(html).toContain('class="md-storage-image"');
    expect(html).toContain(`src="${href}"`);
    expect(html).toContain('uploaded image');
    expect(html).not.toContain('md-storage-file-card');
  });

  it('renders escaped local file image references as image previews', () => {
    const href = 'file:///Users/mini/code/wingmanbefree/autopilot/tmp/uploads/images/shot.png';
    const source = String.raw`\![uploaded image]\(${href})`;

    expect(normalizeEscapedFileReferences(source)).toBe(`![uploaded image](${href})`);

    const html = renderMarkdownToHtml(source);
    expect(html).toContain('class="md-storage-image"');
    expect(html).toContain(`src="${href}"`);
    expect(html).not.toContain('md-storage-file-card');
  });

  it('renders repeatedly escaped local file image references as image previews', () => {
    const href = 'file:///Users/mini/code/wingmanbefree/autopilot/tmp/uploads/images/shot.png';
    const source = String.raw`\\!\[uploaded image\]\\\(${href}\)`;

    expect(normalizeEscapedFileReferences(source)).toBe(`![uploaded image](${href})`);

    const html = renderMarkdownToHtml(source);
    expect(html).toContain('class="md-storage-image"');
    expect(html).toContain(`src="${href}"`);
    expect(html).not.toContain('md-storage-file-card');
  });

  it('renders local non-image file references as file cards', () => {
    const href = 'file:///Users/mini/Documents/Conversation%20Summary.pdf';
    const html = renderMarkdownToHtml(`[Conversation Summary](${href})`);

    expect(html).toContain('class="md-storage-file-card md-reference-file-card"');
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain('data-reference-file-url');
    expect(html).toContain('<strong>Conversation Summary</strong>');
  });

  it('expands exact double-at document references into document cards', () => {
    const source = 'Published as @@Flight Deck and Pipelines - Conversation Summary';
    const expanded = expandInlineReferenceLinks(source, [{
      type: 'doc',
      id: 'doc-1',
      label: 'Flight Deck and Pipelines - Conversation Summary',
    }]);

    expect(expanded).toContain('[Flight Deck and Pipelines - Conversation Summary](mention:doc:doc-1 "reference-card")');

    const html = renderMarkdownToHtml(source, {
      inlineReferences: [{
        type: 'doc',
        id: 'doc-1',
        label: 'Flight Deck and Pipelines - Conversation Summary',
      }],
    });
    expect(html).toContain('mention-link mention-link-doc');
    expect(html).toContain('md-reference-record-card');
    expect(html).toContain('data-mention-id="doc-1"');
    expect(html).toContain('<strong>Flight Deck and Pipelines - Conversation Summary</strong>');
    expect(html).toContain('Flight Deck document');
    expect(html).not.toContain('@@Flight Deck and Pipelines - Conversation Summary');
  });

  it('rendered images have md-storage-image class for modal click targeting', () => {
    const storageHtml = renderMarkdownToHtml('![pic](storage://img-42)');
    expect(storageHtml).toContain('class="md-storage-image');

    const remoteHtml = renderMarkdownToHtml('![pic](https://example.com/photo.jpg)');
    expect(remoteHtml).toContain('class="md-storage-image"');
  });

  it('chat message with storage image renders clickable markup for modal', () => {
    const html = renderMarkdownToHtml('Check this out ![screenshot](storage://obj-abc123)');
    expect(html).toContain('class="md-storage-image md-storage-image-pending"');
    expect(html).toContain('data-storage-object-id="obj-abc123"');
    expect(html).toContain('class="md-storage-image-wrap"');
  });

  it('chat message with remote image renders clickable markup for modal', () => {
    const html = renderMarkdownToHtml('Look at this ![photo](https://cdn.example.com/pic.jpg)');
    expect(html).toContain('class="md-storage-image"');
    expect(html).toContain('src="https://cdn.example.com/pic.jpg"');
    expect(html).toContain('class="md-storage-image-wrap"');
  });

  it('thread reply with mixed content and image renders modal-compatible markup', () => {
    const html = renderMarkdownToHtml([
      'Here is my reply with an image:',
      '',
      '![attachment](storage://thread-img-1)',
      '',
      'And some more text after.',
    ].join('\n'));
    expect(html).toContain('data-storage-object-id="thread-img-1"');
    expect(html).toContain('class="md-storage-image md-storage-image-pending"');
    expect(html).toContain('Here is my reply');
    expect(html).toContain('And some more text after.');
  });

  it('escapes raw html and strips unsafe javascript links', () => {
    const html = renderMarkdownToHtml([
      '<script>alert(1)</script>',
      '',
      '[bad](javascript:alert(1))',
    ].join('\n'));

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).toContain('>bad<');
  });

  it('normalizes document mention links to document cards using the shared doc router type', () => {
    const source = '@[Spec](mention:document:doc-42)';
    expect(normalizeDocumentMentionCardLinks(source)).toBe('[Spec](mention:document:doc-42)');

    const html = renderMarkdownToHtml(source);

    expect(html).toContain('mention-link mention-link-doc');
    expect(html).toContain('md-reference-record-card');
    expect(html).toContain('data-mention-type="doc"');
    expect(html).toContain('data-mention-id="doc-42"');
    expect(html).toContain('<strong>Spec</strong>');
    expect(html).toContain('Flight Deck document');
    expect(html).not.toContain('>@');
  });

  it('renders task mention links as Flight Deck task cards', () => {
    const source = '@[Fix chat task modal](mention:task:task-42)';
    expect(normalizeDocumentMentionCardLinks(source)).toBe('[Fix chat task modal](mention:task:task-42)');

    const html = renderMarkdownToHtml(source);

    expect(html).toContain('mention-link mention-link-task');
    expect(html).toContain('md-reference-record-card');
    expect(html).toContain('data-mention-type="task"');
    expect(html).toContain('data-mention-id="task-42"');
    expect(html).toContain('<strong>Fix chat task modal</strong>');
    expect(html).toContain('Flight Deck task');
    expect(html).not.toContain('>@');
  });

  it('keeps same-origin doc links on the docs route even when copied from chat', () => {
    setWindowHref('http://localhost/demo/chat?channelid=chan-1');

    expect(resolveMarkdownHref('http://localhost/demo/chat?docid=doc-42'))
      .toBe('http://localhost/demo/docs?docid=doc-42');

    const html = renderMarkdownToHtml('[doc](http://localhost/demo/chat?docid=doc-42)');
    expect(html).toContain('href="http://localhost/demo/docs?docid=doc-42"');
  });

  it('supports relative document links from the current chat route', () => {
    setWindowHref('http://localhost/demo/chat?channelid=chan-1');

    expect(resolveMarkdownHref('?docid=doc-99')).toBe('http://localhost/demo/docs?docid=doc-99');

    const html = renderMarkdownToHtml('[doc](?docid=doc-99)');
    expect(html).toContain('href="http://localhost/demo/docs?docid=doc-99"');
  });

  it('normalizes bare task links onto the current workspace route', () => {
    setWindowHref('http://localhost/demo/chat?channelid=chan-1&workspacekey=wk-1');

    expect(resolveMarkdownHref('/tasks?scopeid=scope-1&taskid=task-42'))
      .toBe('http://localhost/demo/tasks?scopeid=scope-1&taskid=task-42&workspacekey=wk-1');

    const html = renderMarkdownToHtml('[task](/tasks?scopeid=scope-1&taskid=task-42)');
    expect(html).toContain('href="http://localhost/demo/tasks?scopeid=scope-1&amp;taskid=task-42&amp;workspacekey=wk-1"');
  });
});
