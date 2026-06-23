function commentTimestamp(comment = {}) {
  const updatedTs = Date.parse(comment?.updated_at || '');
  if (Number.isFinite(updatedTs)) return updatedTs;
  const createdTs = Date.parse(comment?.created_at || '');
  return Number.isFinite(createdTs) ? createdTs : 0;
}

export function sortCommentsNewestFirst(comments = []) {
  if (!Array.isArray(comments) || comments.length <= 1) return Array.isArray(comments) ? comments : [];
  return [...comments].sort((left, right) => {
    const delta = commentTimestamp(right) - commentTimestamp(left);
    if (delta !== 0) return delta;
    return String(right?.record_id || '').localeCompare(String(left?.record_id || ''));
  });
}
