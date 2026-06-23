import { marked } from 'marked';
import { normalizeDocumentBlocks } from '../../utils/state-helpers.js';
import { createFlightDeckBlockId } from './prosemirror-flightdeck-schema.js';

function textNode(text, marks = []) {
  const value = String(text || '');
  if (!value) return null;
  return marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

function paragraphFromText(text, attrs = {}) {
  const node = { type: 'paragraph', attrs };
  const child = textNode(text);
  if (child) node.content = [child];
  return node;
}

function marksForToken(token = {}) {
  const marks = [];
  if (token.type === 'strong') marks.push({ type: 'bold' });
  if (token.type === 'em') marks.push({ type: 'italic' });
  if (token.type === 'codespan') marks.push({ type: 'code' });
  if (token.type === 'link') marks.push({ type: 'link', attrs: { href: token.href, title: token.title || null } });
  return marks;
}

function mentionMarkFromText(text) {
  const match = String(text || '').match(/^@\[([^\]]+)]\(mention:([^:()]+):([^)]+)\)$/);
  if (!match) return null;
  return {
    type: 'fdMention',
    attrs: {
      label: match[1],
      mentionType: match[2],
      mentionId: match[3],
    },
  };
}

function inlineContent(tokens = [], inheritedMarks = []) {
  const out = [];
  for (const token of tokens || []) {
    if (!token) continue;
    if (token.type === 'text' || token.type === 'escape') {
      const mention = mentionMarkFromText(token.text);
      const node = textNode(token.text, mention ? [...inheritedMarks, mention] : inheritedMarks);
      if (node) out.push(node);
      continue;
    }
    if (token.type === 'br') {
      out.push({ type: 'hardBreak' });
      continue;
    }
    if (token.type === 'image') {
      out.push({
        type: 'fdStorageImage',
        attrs: {
          src: token.href,
          alt: token.text || null,
          title: token.title || null,
          objectId: String(token.href || '').startsWith('storage://') ? String(token.href).slice('storage://'.length) : null,
        },
      });
      continue;
    }
    const nextMarks = [...inheritedMarks, ...marksForToken(token)];
    if (Array.isArray(token.tokens)) {
      out.push(...inlineContent(token.tokens, nextMarks));
    } else {
      const node = textNode(token.text || token.raw || '', nextMarks);
      if (node) out.push(node);
    }
  }
  return out;
}

function listItemFromToken(item = {}, taskList = false) {
  const attrs = taskList ? { checked: item.checked === true } : {};
  const children = [];
  const inline = inlineContent(item.tokens || []);
  children.push(inline.length > 0 ? { type: 'paragraph', content: inline } : paragraphFromText(item.text || ''));
  return { type: taskList ? 'taskItem' : 'listItem', attrs, content: children };
}

function tableFromToken(token = {}, attrs = {}) {
  const rows = [];
  const headerCells = (token.header || []).map((cell) => ({
    type: 'tableHeader',
    content: [{ type: 'paragraph', content: inlineContent(cell.tokens || [{ type: 'text', text: cell.text || '' }]) }],
  }));
  if (headerCells.length > 0) rows.push({ type: 'tableRow', content: headerCells });
  for (const row of token.rows || []) {
    rows.push({
      type: 'tableRow',
      content: row.map((cell) => ({
        type: 'tableCell',
        content: [{ type: 'paragraph', content: inlineContent(cell.tokens || [{ type: 'text', text: cell.text || '' }]) }],
      })),
    });
  }
  return { type: 'table', attrs, content: rows };
}

function nodeFromToken(token = {}, attrs = {}) {
  if (token.type === 'heading') {
    return { type: 'heading', attrs: { ...attrs, level: token.depth || 1 }, content: inlineContent(token.tokens || []) };
  }
  if (token.type === 'paragraph') {
    const inline = inlineContent(token.tokens || []);
    return inline.length > 0 ? { type: 'paragraph', attrs, content: inline } : paragraphFromText(token.text || '', attrs);
  }
  if (token.type === 'code') {
    return {
      type: 'codeBlock',
      attrs: { ...attrs, language: token.lang || null },
      content: token.text ? [{ type: 'text', text: token.text }] : [],
    };
  }
  if (token.type === 'blockquote') {
    return {
      type: 'blockquote',
      attrs,
      content: tokensToProseMirrorNodes(token.tokens || [], []),
    };
  }
  if (token.type === 'hr') {
    return { type: 'horizontalRule', attrs };
  }
  if (token.type === 'list') {
    const taskList = (token.items || []).some((item) => item.task);
    return {
      type: taskList ? 'taskList' : (token.ordered ? 'orderedList' : 'bulletList'),
      attrs: token.ordered ? { ...attrs, start: token.start || 1 } : attrs,
      content: (token.items || []).map((item) => listItemFromToken(item, taskList)),
    };
  }
  if (token.type === 'table') return tableFromToken(token, attrs);
  if (token.type === 'space') return null;
  return paragraphFromText(token.raw || token.text || '', attrs);
}

function tokensToProseMirrorNodes(tokens = [], contentBlocks = []) {
  const normalizedBlocks = normalizeDocumentBlocks(contentBlocks);
  let blockIndex = 0;
  return (tokens || [])
    .map((token) => {
      if (token?.type === 'space') return null;
      const block = normalizedBlocks[blockIndex] || null;
      blockIndex += 1;
      const attrs = { fdBlockId: String(block?.id || '').trim() || createFlightDeckBlockId() };
      return nodeFromToken(token, attrs);
    })
    .filter(Boolean);
}

export function markdownToProseMirrorDoc(content = '', options = {}) {
  const source = String(content || '');
  const tokens = marked.lexer(source);
  const nodes = tokensToProseMirrorNodes(tokens, options.contentBlocks || []);
  return {
    type: 'doc',
    content: nodes.length > 0 ? nodes : [{ type: 'paragraph', attrs: { fdBlockId: createFlightDeckBlockId() } }],
  };
}

export function resolveDocumentProseMirrorState(document = {}) {
  const state = document?.editor_state && typeof document.editor_state === 'object' && !Array.isArray(document.editor_state)
    ? document.editor_state
    : null;
  if (state?.type === 'doc') return state;
  return markdownToProseMirrorDoc(document?.content || '', { contentBlocks: document?.content_blocks || [] });
}
