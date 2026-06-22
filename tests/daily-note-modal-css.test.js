import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'styles.css'), 'utf8');

function extractDeclarations(selector) {
  const idx = css.indexOf(selector);
  if (idx < 0) return '';
  const start = css.indexOf('{', idx);
  if (start < 0) return '';
  let depth = 1;
  let i = start + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(start + 1, i - 1).trim();
}

describe('daily note modal CSS', () => {
  it('keeps the focus editor scrollable within the viewport', () => {
    const modalDecl = extractDeclarations('.daily-note-modal');
    const actionsDecl = extractDeclarations('.daily-note-modal .new-doc-modal-actions');

    expect(modalDecl).toMatch(/max-height\s*:\s*min\(88dvh,\s*820px\)/);
    expect(modalDecl).toMatch(/overflow-y\s*:\s*auto/);
    expect(modalDecl).toMatch(/overscroll-behavior\s*:\s*contain/);
    expect(actionsDecl).toMatch(/position\s*:\s*static/);
    expect(actionsDecl).not.toMatch(/bottom\s*:\s*0/);
    expect(actionsDecl).toMatch(/margin-top\s*:\s*1rem/);
    expect(css).toContain('.doc-modal-backdrop:has(.daily-note-modal)');
    expect(css).toContain('max-height: calc(100dvh - 1rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));');
  });
});
