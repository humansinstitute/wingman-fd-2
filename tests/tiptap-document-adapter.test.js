import { describe, expect, it } from 'vitest';
import { markdownToProseMirrorDoc } from '../src/docs/editor/markdown-to-prosemirror.js';
import { prosemirrorToFlightDeckContentModel } from '../src/docs/editor/prosemirror-to-flightdeck.js';
import {
  FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT,
  PROSEMIRROR_JSON_FORMAT,
} from '../src/docs/editor/prosemirror-flightdeck-schema.js';

describe('Tiptap document adapter', () => {
  it('imports Markdown into ProseMirror JSON and exports Flight Deck compatibility fields', () => {
    const source = [
      '# Spec',
      '',
      'Hello @[Pete](mention:person:npub1pete) with [a link](https://example.com).',
      '',
      '- [x] Done',
      '- [ ] Todo',
      '',
      '![Diagram](storage://object-123)',
    ].join('\n');
    const contentBlocks = [
      { id: 'heading-a', type: 'heading', text: '# Spec' },
      { id: 'paragraph-a', type: 'paragraph', text: 'Hello Pete' },
      { id: 'tasks-a', type: 'list', text: '- [x] Done\n- [ ] Todo' },
      { id: 'image-a', type: 'image', text: '![Diagram](storage://object-123)' },
    ];

    const doc = markdownToProseMirrorDoc(source, { contentBlocks });
    const model = prosemirrorToFlightDeckContentModel(doc);

    expect(model.content_format).toBe(FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT);
    expect(model.editor_state_format).toBe(PROSEMIRROR_JSON_FORMAT);
    expect(model.editor_state).toEqual(doc);
    expect(model.content).toContain('# Spec');
    expect(model.content).toContain('Hello @[Pete](mention:person:npub1pete) with');
    expect(model.content).not.toContain('@@[Pete]');
    expect(model.content).toContain('storage://object-123');
    const paragraph = doc.content.find((node) => node.attrs?.fdBlockId === 'paragraph-a');
    const mentionNode = paragraph.content.find((node) => node.marks?.some((mark) => mark.type === 'fdMention'));
    expect(mentionNode).toMatchObject({
      type: 'text',
      text: 'Pete',
      marks: [{
        type: 'fdMention',
        attrs: {
          label: 'Pete',
          mentionType: 'person',
          mentionId: 'npub1pete',
        },
      }],
    });
    expect(model.content_blocks.map((block) => block.id)).toEqual([
      'heading-a',
      'paragraph-a',
      'tasks-a',
      'image-a',
    ]);
  });
});
