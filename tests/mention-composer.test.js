// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  canonicalActorMentions,
  createMentionPill,
  hydrateMentionComposer,
  insertPlainTextAtSelection,
  removeAdjacentMentionPill,
  serializeMentionComposer,
} from '../src/mention-composer.js';

const rick = 'npub1rick';
const token = `@[Rick](mention:person:${rick})`;

function composer(value = '') {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  hydrateMentionComposer(root, value);
  return root;
}

function caret(root, node, offset) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  root.focus();
}

describe('tokenized mention composer', () => {
  it('hydrates a canonical actor mention as an atomic accessible pill and serializes losslessly', () => {
    const root = composer(`Hello ${token} there`);
    const pill = root.querySelector('[data-mention-token]');

    expect(pill.textContent).toBe('@Rick');
    expect(pill.contentEditable).toBe('false');
    expect(pill.getAttribute('aria-label')).toBe('Mention Rick');
    expect(serializeMentionComposer(root)).toBe(`Hello ${token} there`);
    expect(canonicalActorMentions(serializeMentionComposer(root))).toEqual([
      { label: 'Rick', type: 'person', npub: rick },
    ]);
  });

  it('keeps text before and after an inserted pill in canonical order', () => {
    const root = composer();
    root.replaceChildren(
      document.createTextNode('before '),
      createMentionPill(document, { label: 'Rick', type: 'agent', npub: rick }),
      document.createTextNode(' after'),
    );
    expect(serializeMentionComposer(root)).toBe(`before @[Rick](mention:agent:${rick}) after`);
  });

  it('removes the whole pill with one adjacent backspace', () => {
    const root = composer(`${token} after`);
    const trailing = root.lastChild;
    caret(root, trailing, 0);

    expect(removeAdjacentMentionPill(root, 'backward')).toBe(true);
    expect(serializeMentionComposer(root)).toBe(' after');
    expect(canonicalActorMentions(serializeMentionComposer(root))).toEqual([]);
  });

  it('pastes plain multiline text without importing rich HTML', () => {
    const root = composer(token);
    caret(root, root, root.childNodes.length);
    insertPlainTextAtSelection(root, '\nplain <b>text</b>');

    expect(root.querySelector('b')).toBeNull();
    expect(serializeMentionComposer(root)).toBe(`${token}\nplain <b>text</b>`);
  });

  it('hydrates an empty model after send/reset', () => {
    const root = composer(`draft ${token}`);
    hydrateMentionComposer(root, '');
    expect(root.childNodes).toHaveLength(0);
    expect(serializeMentionComposer(root)).toBe('');
  });
});
