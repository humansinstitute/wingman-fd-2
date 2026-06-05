import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const stylesCss = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('task comment preview rendering', () => {
  it('renders task comments with preview measurement hooks and toggle control', () => {
    expect(indexHtml).toContain('data-task-comment-preview-id');
    expect(indexHtml).toContain('data-task-comment-preview-max-lines');
    expect(indexHtml).toContain('isTaskCommentTruncated(comment.record_id)');
    expect(indexHtml).toContain('toggleTaskCommentExpanded(comment.record_id)');
    expect(indexHtml).toContain('Show more...');
    expect(indexHtml).toContain('Show less');
  });

  it('styles collapsed task comments independently from audio attachments and reactions', () => {
    expect(stylesCss).toContain('.task-comment-body-collapsed');
    expect(stylesCss).toContain('max-height: calc(12 * 1.45em)');
    expect(stylesCss).toContain('.task-comment-expand-btn');
  });
});
