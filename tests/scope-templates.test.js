import { describe, expect, it } from 'vitest';
import {
  getScopeTemplate,
  PRODUCT_SCOPE_TEMPLATE,
  renderScopeTemplate,
} from '../src/scope-templates.js';

describe('scope templates', () => {
  it('renders the Product template with name and workingdir variables', () => {
    const rendered = renderScopeTemplate(PRODUCT_SCOPE_TEMPLATE, {
      title: 'Product Score',
      workingdir: '/Users/mini/code/product-score',
    });

    expect(rendered.scope.title).toBe('Product Score');
    expect(rendered.scope.description).toContain('/Users/mini/code/product-score');
    expect(rendered.channels.map((channel) => channel.name)).toEqual([
      'features',
      'implementation',
      'bugs',
      'refactoring',
    ]);
    expect(rendered.channels.every((channel) => channel.basePrompt.includes('Product Score'))).toBe(true);
    expect(rendered.channels.every((channel) => channel.basePrompt.includes('/Users/mini/code/product-score'))).toBe(true);
    expect(JSON.stringify(rendered)).not.toContain('$title');
    expect(JSON.stringify(rendered)).not.toContain('$workingdir');
  });

  it('requires Product template variables', () => {
    expect(() => renderScopeTemplate(PRODUCT_SCOPE_TEMPLATE, {
      title: 'Product Score',
    })).toThrow('Missing template variables: workingdir');
  });

  it('finds the Product template by id', () => {
    expect(getScopeTemplate('product')).toBe(PRODUCT_SCOPE_TEMPLATE);
  });
});
