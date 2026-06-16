import productTemplate from '../docs/templates/product.json';

export const PRODUCT_SCOPE_TEMPLATE = productTemplate;

export const SCOPE_TEMPLATES = [
  PRODUCT_SCOPE_TEMPLATE,
];

function normalizeTemplateVariableValue(value) {
  return String(value ?? '').trim();
}

function renderTemplateText(value, variables = {}) {
  return String(value ?? '').replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key)
      ? normalizeTemplateVariableValue(variables[key])
      : match
  ));
}

function renderTemplateObject(value, variables = {}) {
  if (Array.isArray(value)) return value.map((item) => renderTemplateObject(item, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renderTemplateObject(entry, variables)]),
    );
  }
  if (typeof value === 'string') return renderTemplateText(value, variables);
  return value;
}

export function renderScopeTemplate(template, variables = {}) {
  if (!template || typeof template !== 'object') {
    throw new Error('Template is required');
  }
  const missing = (template.variables || [])
    .filter((variable) => variable?.required && !normalizeTemplateVariableValue(variables[variable.name]))
    .map((variable) => variable.name);
  if (missing.length > 0) {
    throw new Error(`Missing template variables: ${missing.join(', ')}`);
  }
  return renderTemplateObject(template, variables);
}

export function getScopeTemplate(templateId) {
  const id = normalizeTemplateVariableValue(templateId);
  return SCOPE_TEMPLATES.find((template) => template.id === id) || null;
}
