export function hasPreviewId(ids = [], recordId) {
  if (!recordId) return false;
  return Array.isArray(ids) && ids.includes(recordId);
}

export function togglePreviewId(ids = [], recordId) {
  if (!recordId) return Array.isArray(ids) ? ids : [];
  const currentIds = Array.isArray(ids) ? ids : [];
  if (currentIds.includes(recordId)) {
    return currentIds.filter((id) => id !== recordId);
  }
  return [...currentIds, recordId];
}

export function prunePreviewState({ expandedIds = [], truncatedIds = [], validIds = [] } = {}) {
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  return {
    expandedIds: (Array.isArray(expandedIds) ? expandedIds : []).filter((id) => valid.has(id)),
    truncatedIds: (Array.isArray(truncatedIds) ? truncatedIds : []).filter((id) => valid.has(id)),
  };
}

function scheduleUiNextTick(callback) {
  const nextTick = globalThis.Alpine?.nextTick;
  if (typeof nextTick === 'function') {
    nextTick(callback);
    return;
  }
  queueMicrotask(callback);
}

export function measureTruncatedPreviewIds({
  root = null,
  selector,
  idDatasetKey,
  maxLinesDatasetKey,
  defaultMaxLines,
} = {}) {
  const measurementRoot = root || (typeof document !== 'undefined' ? document : null);
  if (!measurementRoot || !selector || !idDatasetKey || typeof window === 'undefined') return [];
  const previews = [...measurementRoot.querySelectorAll(selector)];
  const nextTruncatedIds = [];

  for (const preview of previews) {
    const recordId = String(preview.dataset?.[idDatasetKey] || '').trim();
    if (!recordId) continue;
    const styles = window.getComputedStyle(preview);
    const lineHeight = parseFloat(styles.lineHeight);
    const maxLines = Number(preview.dataset?.[maxLinesDatasetKey] || defaultMaxLines);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0 || !Number.isFinite(maxLines) || maxLines <= 0) continue;
    if ((preview.scrollHeight - (lineHeight * maxLines)) > 1) nextTruncatedIds.push(recordId);
  }

  return [...new Set(nextTruncatedIds)];
}

export function schedulePreviewMeasurement({
  getFrameId,
  setFrameId,
  setTruncatedIds,
  selector,
  idDatasetKey,
  maxLinesDatasetKey,
  defaultMaxLines,
} = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  scheduleUiNextTick(() => {
    const currentFrameId = typeof getFrameId === 'function' ? getFrameId() : null;
    if (currentFrameId) window.cancelAnimationFrame(currentFrameId);
    const nextFrameId = window.requestAnimationFrame(() => {
      setFrameId?.(null);
      setTruncatedIds?.(measureTruncatedPreviewIds({
        selector,
        idDatasetKey,
        maxLinesDatasetKey,
        defaultMaxLines,
      }));
    });
    setFrameId?.(nextFrameId);
  });
}
