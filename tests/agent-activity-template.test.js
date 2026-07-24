import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('agent activity template', () => {
  it('renders compact and expanded safe fields without HTML injection', () => {
    expect(html).toContain('getAgentActivitiesForMessage(msg)');
    expect(html).toContain('activeThreadAgentActivities');
    expect(html).toContain('x-text="activity.summary"');
    expect(html).toContain('x-text="activity.body"');
    expect(html).not.toContain('x-html="activity.body"');
  });
});
