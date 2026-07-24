export const WORKROOMS_FEATURE_FLAG = 'workrooms';

export function workspaceFeatureFlags(metadata = {}) {
  const flags = metadata?.feature_flags;
  return flags && typeof flags === 'object' && !Array.isArray(flags) ? flags : {};
}

export function isWorkspaceFeatureEnabled(metadata, feature) {
  return workspaceFeatureFlags(metadata)[feature] === true;
}

export function withWorkspaceFeatureFlag(metadata = {}, feature, enabled) {
  const current = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return {
    ...current,
    feature_flags: {
      ...workspaceFeatureFlags(current),
      [feature]: enabled === true,
    },
  };
}
