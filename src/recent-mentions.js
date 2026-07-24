import { canonicalActorMentions } from './mention-composer.js';

function messageTimestamp(message = {}) {
  return Date.parse(message.updated_at || message.created_at || '') || 0;
}

function messageMentions(message = {}) {
  const metadata = message.pg_metadata || message.metadata || {};
  return Array.isArray(metadata.mentions) ? metadata.mentions : [];
}

function messageBelongsToThread(message = {}, threadId = '') {
  if (!threadId) return false;
  return [message.record_id, message.thread_id, message.thread_root_id, message.parent_message_id]
    .some((value) => String(value || '').trim() === threadId);
}

export function rankRecentActorMentions({
  messages = [],
  threadId = '',
  mentionPeople = [],
  currentUserNpub = '',
  draft = '',
  limit = 8,
} = {}) {
  const peopleByNpub = new Map(
    mentionPeople
      .filter((person) => ['agent', 'person'].includes(person?.type) && person?.id)
      .map((person) => [String(person.id).trim(), person]),
  );
  const excluded = new Set([
    String(currentUserNpub || '').trim(),
    ...canonicalActorMentions(draft).map((mention) => String(mention.npub || '').trim()),
  ].filter(Boolean));
  const activeThreadId = String(threadId || '').trim();
  const recentFirst = [...messages]
    .filter((message) => String(message?.record_state || 'active') !== 'deleted')
    .sort((left, right) => messageTimestamp(right) - messageTimestamp(left));
  const rankedMessages = activeThreadId
    ? [
        ...recentFirst.filter((message) => messageBelongsToThread(message, activeThreadId)),
        ...recentFirst.filter((message) => !messageBelongsToThread(message, activeThreadId)),
      ]
    : recentFirst;
  const results = [];
  const seen = new Set();

  for (const message of rankedMessages) {
    for (const mention of [...messageMentions(message)].reverse()) {
      const npub = String(mention?.npub || mention?.id || '').trim();
      const person = peopleByNpub.get(npub);
      if (!npub || !person || excluded.has(npub) || seen.has(npub)) continue;
      seen.add(npub);
      results.push(person);
      if (results.length >= limit) return results;
    }
  }
  return results;
}
