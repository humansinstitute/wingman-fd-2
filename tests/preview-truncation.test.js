import { describe, expect, it, vi } from 'vitest';
import {
  hasPreviewId,
  measureTruncatedPreviewIds,
  prunePreviewState,
  schedulePreviewMeasurement,
  togglePreviewId,
} from '../src/preview-truncation.js';

describe('preview truncation helpers', () => {
  it('checks and toggles expanded ids', () => {
    expect(hasPreviewId(['a'], 'a')).toBe(true);
    expect(hasPreviewId(['a'], 'b')).toBe(false);
    expect(togglePreviewId(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePreviewId(['a', 'b'], 'a')).toEqual(['b']);
    expect(togglePreviewId(['a'], '')).toEqual(['a']);
  });

  it('prunes expanded and truncated ids to valid records', () => {
    expect(prunePreviewState({
      expandedIds: ['a', 'stale'],
      truncatedIds: ['b', 'stale'],
      validIds: ['a', 'b'],
    })).toEqual({
      expandedIds: ['a'],
      truncatedIds: ['b'],
    });
  });

  it('measures overflowing preview elements once per record', () => {
    const longPreview = {
      dataset: { previewId: 'long', previewMaxLines: '2' },
      scrollHeight: 61,
    };
    const duplicateLongPreview = {
      dataset: { previewId: 'long', previewMaxLines: '2' },
      scrollHeight: 80,
    };
    const shortPreview = {
      dataset: { previewId: 'short', previewMaxLines: '2' },
      scrollHeight: 40,
    };
    const root = {
      querySelectorAll: vi.fn(() => [longPreview, duplicateLongPreview, shortPreview]),
    };
    vi.stubGlobal('window', {
      getComputedStyle: () => ({ lineHeight: '20px' }),
    });

    try {
      expect(measureTruncatedPreviewIds({
        root,
        selector: '[data-preview-id]',
        idDatasetKey: 'previewId',
        maxLinesDatasetKey: 'previewMaxLines',
        defaultMaxLines: 2,
      })).toEqual(['long']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('schedules measurement through requestAnimationFrame', async () => {
    const preview = {
      dataset: { previewId: 'long', previewMaxLines: '1' },
      scrollHeight: 41,
    };
    const setFrameId = vi.fn();
    const setTruncatedIds = vi.fn();
    vi.stubGlobal('document', {
      querySelectorAll: vi.fn(() => [preview]),
    });
    vi.stubGlobal('window', {
      cancelAnimationFrame: vi.fn(),
      getComputedStyle: () => ({ lineHeight: '20px' }),
      requestAnimationFrame: (callback) => {
        callback();
        return 17;
      },
    });

    try {
      schedulePreviewMeasurement({
        getFrameId: () => null,
        setFrameId,
        setTruncatedIds,
        selector: '[data-preview-id]',
        idDatasetKey: 'previewId',
        maxLinesDatasetKey: 'previewMaxLines',
        defaultMaxLines: 1,
      });
      await new Promise((resolve) => {
        queueMicrotask(() => {
          expect(setFrameId).toHaveBeenCalledWith(null);
          expect(setFrameId).toHaveBeenCalledWith(17);
          expect(setTruncatedIds).toHaveBeenCalledWith(['long']);
          resolve();
        });
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
