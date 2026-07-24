import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('structured mention pill styling', () => {
  it('uses one generic compact pill selector for composer and rendered mention types', () => {
    expect(css).toMatch(/\.mention-composer-pill,\s*\.mention-pill\s*\{/);
    expect(css).toMatch(/\.mention-link\.mention-pill:hover\s*\{/);
    expect(css).toContain('border-radius: 999px');
    expect(css).not.toContain('.chat-post-markdown .mention-link-person');
  });
});
