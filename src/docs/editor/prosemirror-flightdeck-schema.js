import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

export const FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT = 'flightdeck_prosemirror_v1';
export const PROSEMIRROR_JSON_FORMAT = 'prosemirror_json_v1';
export const PROSEMIRROR_JSON_VERSION = 1;

export function createFlightDeckBlockId() {
  return globalThis.crypto?.randomUUID
    ? `pm_${globalThis.crypto.randomUUID()}`
    : `pm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const TOP_LEVEL_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
]);

function shouldCarryBlockId(typeName) {
  return TOP_LEVEL_BLOCK_TYPES.has(String(typeName || ''));
}

export const FlightDeckBlockIdExtension = Extension.create({
  name: 'fdBlockId',
  addGlobalAttributes() {
    return [
      {
        types: [...TOP_LEVEL_BLOCK_TYPES],
        attributes: {
          fdBlockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-fd-block-id'),
            renderHTML: (attributes) => (
              attributes.fdBlockId ? { 'data-fd-block-id': attributes.fdBlockId } : {}
            ),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) => {
          let tr = null;
          newState.doc.descendants((node, pos, parent) => {
            if (parent !== newState.doc || !shouldCarryBlockId(node.type.name) || node.attrs.fdBlockId) return;
            tr = tr || newState.tr;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, fdBlockId: createFlightDeckBlockId() });
          });
          return tr;
        },
      }),
    ];
  },
});

export const FlightDeckMention = Mark.create({
  name: 'fdMention',
  inclusive: false,
  addAttributes() {
    return {
      mentionType: { default: null },
      mentionId: { default: null },
      label: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-fd-mention-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-fd-mention-type': HTMLAttributes.mentionType,
      'data-fd-mention-id': HTMLAttributes.mentionId,
      class: 'fd-mention',
    }), 0];
  },
});

export const FlightDeckStorageFile = Node.create({
  name: 'fdStorageFile',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
      label: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-fd-storage-file]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-fd-storage-file': HTMLAttributes.src,
      class: 'fd-storage-file-card',
    }), HTMLAttributes.label || HTMLAttributes.title || HTMLAttributes.src || 'File'];
  },
});

export const FlightDeckStorageImage = Image.extend({
  name: 'fdStorageImage',
  addAttributes() {
    return {
      ...this.parent?.(),
      objectId: { default: null },
      title: { default: null },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, {
      'data-fd-storage-object-id': HTMLAttributes.objectId,
    })];
  },
});

export function createFlightDeckTiptapExtensions(options = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    Placeholder.configure({
      placeholder: options.placeholder || 'Start writing...',
    }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    FlightDeckStorageImage,
    FlightDeckStorageFile,
    FlightDeckMention,
    FlightDeckBlockIdExtension,
  ];
}
