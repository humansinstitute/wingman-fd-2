/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  downloadStorageObjectBlobMock,
  getCachedStorageImageMock,
  cacheStorageImageMock,
} = vi.hoisted(() => ({
  downloadStorageObjectBlobMock: vi.fn(),
  getCachedStorageImageMock: vi.fn(),
  cacheStorageImageMock: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  downloadStorageObjectBlob: downloadStorageObjectBlobMock,
}));

vi.mock('../src/db.js', () => ({
  getCachedStorageImage: getCachedStorageImageMock,
  cacheStorageImage: cacheStorageImageMock,
}));

vi.mock('../src/logging.js', () => ({
  flightDeckLog: vi.fn(),
}));

import { storageImageManagerMixin } from '../src/storage-image-manager.js';

function createStore(overrides = {}) {
  return {
    ...storageImageManagerMixin,
    storageImageUrlCache: {},
    storageImageLoadPromises: {},
    storageImageFailureCache: {},
    backendUrl: 'https://tower.example',
    scheduleChatPreviewMeasurement: vi.fn(),
    scheduleTaskCommentPreviewMeasurement: vi.fn(),
    captureScrollAnchor: vi.fn(() => null),
    restoreScrollAnchor: vi.fn(),
    ...overrides,
  };
}

describe('storageImageManagerMixin', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete globalThis.MutationObserver;
    downloadStorageObjectBlobMock.mockReset();
    getCachedStorageImageMock.mockReset();
    cacheStorageImageMock.mockReset();
  });

  it('reattaches cached blob URLs to recreated storage image nodes without fetching', () => {
    document.body.innerHTML = `
      <img class="md-storage-image md-storage-image-pending" data-storage-object-id="img-1" alt="cached" />
    `;
    const store = createStore({
      storageImageUrlCache: {
        'https://tower.example::img-1': 'blob:https://app.example/cached-img-1',
      },
    });

    store.hydrateStorageImages();

    const image = document.querySelector('img[data-storage-object-id="img-1"]');
    expect(image.getAttribute('src')).toBe('blob:https://app.example/cached-img-1');
    expect(image.dataset.storageResolved).toBe('true');
    expect(image.classList.contains('md-storage-image-pending')).toBe(false);
    expect(downloadStorageObjectBlobMock).not.toHaveBeenCalled();
    expect(getCachedStorageImageMock).not.toHaveBeenCalled();
  });

  it('falls back to object-id cache entries created before backend-aware cache keys', () => {
    document.body.innerHTML = `
      <img class="md-storage-image md-storage-image-pending" data-storage-object-id="img-legacy" alt="cached" />
    `;
    const store = createStore({
      storageImageUrlCache: {
        'img-legacy': 'blob:https://app.example/legacy-img',
      },
    });

    store.hydrateStorageImages();

    const image = document.querySelector('img[data-storage-object-id="img-legacy"]');
    expect(image.getAttribute('src')).toBe('blob:https://app.example/legacy-img');
    expect(downloadStorageObjectBlobMock).not.toHaveBeenCalled();
  });

  it('schedules hydration when Alpine inserts a fresh storage image node after render', () => {
    let observerCallback = null;
    const observe = vi.fn();
    globalThis.MutationObserver = vi.fn((callback) => {
      observerCallback = callback;
      return { observe, disconnect: vi.fn() };
    });

    const store = createStore();
    store.scheduleStorageImageHydration = vi.fn();

    store.ensureStorageImageHydrationObserver();
    expect(observe).toHaveBeenCalledWith(document.body, { childList: true, subtree: true });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<img class="md-storage-image md-storage-image-pending" data-storage-object-id="img-new" alt="new" />';
    observerCallback([{ addedNodes: [wrapper] }]);

    expect(store.scheduleStorageImageHydration).toHaveBeenCalled();
  });
});
