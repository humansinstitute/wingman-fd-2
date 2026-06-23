import { resolveDocumentProseMirrorState } from './markdown-to-prosemirror.js';
import { prosemirrorToFlightDeckContentModel } from './prosemirror-to-flightdeck.js';
import { FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT } from './prosemirror-flightdeck-schema.js';

export function shouldUseRichDocumentEditor(document = {}, options = {}) {
  if (document?.content_format === FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT) return true;
  if (options.enabled === true) return true;
  return true;
}

export function createDocumentEditorState(document = {}) {
  const editorState = resolveDocumentProseMirrorState(document);
  return {
    editorState,
    contentModel: prosemirrorToFlightDeckContentModel(editorState),
  };
}
