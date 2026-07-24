const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

function text(value) {
  return String(value ?? '').trim();
}

export function isTerminalAgentActivity(activity = {}) {
  return TERMINAL_STATES.has(text(activity.state).toLowerCase());
}

export function mapPgAgentActivity(activity = {}) {
  const recordId = text(activity.id || activity.record_id);
  const activityId = text(activity.activity_id);
  const visibility = text(activity.visibility);
  const sequence = Number(activity.sequence);
  if (!recordId || !activityId || visibility !== 'user_visible' || !Number.isSafeInteger(sequence) || sequence < 0) return null;
  return {
    record_id: recordId,
    activity_id: activityId,
    pg_backend: true,
    workspace_id: text(activity.workspace_id),
    scope_id: text(activity.scope_id),
    channel_id: text(activity.channel_id),
    thread_id: text(activity.thread_id),
    trigger_message_id: text(activity.trigger_message_id),
    session_id: text(activity.session_id),
    agent_npub: text(activity.agent_npub),
    state: text(activity.state).toLowerCase(),
    label: text(activity.label),
    summary: text(activity.summary),
    body: text(activity.body),
    visibility,
    sequence,
    expires_at: text(activity.expires_at),
    terminal_at: text(activity.terminal_at),
    created_at: text(activity.created_at),
    updated_at: text(activity.updated_at),
  };
}

export function isVisibleAgentActivity(activity = {}, nowMs = Date.now()) {
  if (!activity?.record_id || activity.visibility !== 'user_visible' || isTerminalAgentActivity(activity)) return false;
  const expiresAt = Date.parse(activity.expires_at || '');
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

export function reconcileAgentActivity(current, incoming) {
  if (!incoming?.record_id) return current || null;
  if (isTerminalAgentActivity(incoming)) return null;
  if (!current?.record_id) return incoming;
  if (current.activity_id !== incoming.activity_id) return incoming;
  return Number(incoming.sequence) > Number(current.sequence) ? incoming : current;
}
