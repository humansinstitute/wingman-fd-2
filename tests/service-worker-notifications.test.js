import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { buildServiceWorkerSource } from '../vite.config.js';

function loadServiceWorkerHarness() {
  const handlers = new Map();
  const shownNotifications = [];
  const context = {
    URL,
    Response,
    fetch: async () => new Response('ok'),
    caches: {
      async open() {
        return {
          async addAll() {},
          async match() { return null; },
          put() {},
        };
      },
      async keys() { return []; },
      async delete() { return true; },
    },
    self: {
      location: { origin: 'https://flightdeck.example' },
      registration: {
        showNotification(title, options) {
          shownNotifications.push({ title, options });
          return Promise.resolve();
        },
      },
      clients: {
        async matchAll() { return []; },
        async openWindow() {},
      },
      skipWaiting() {},
      addEventListener(type, handler) {
        handlers.set(type, handler);
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(buildServiceWorkerSource('test-build'), context);
  return { handlers, shownNotifications };
}

async function dispatchPush(payload) {
  const { handlers, shownNotifications } = loadServiceWorkerHarness();
  const waits = [];
  handlers.get('push')({
    data: { json: () => payload },
    waitUntil(promise) {
      waits.push(promise);
    },
  });
  await Promise.all(waits);
  return shownNotifications[0];
}

describe('generated notification service worker', () => {
  it('routes chat thread notifications to channel and thread params', async () => {
    const notification = await dispatchPush({
      title: 'Flight Deck: Pete',
      body: 'Thread Update in Engineering',
      target: {
        type: 'thread',
        workspace_slug: 'pete',
        workspace_key: 'service:npub1app::workspace:npub1workspace',
        channel_id: 'channel-1',
        thread_id: 'thread-1',
      },
    });

    const url = new URL(notification.options.data.url);
    expect(url.pathname).toBe('/pete/chat');
    expect(url.searchParams.get('workspacekey')).toBe('service:npub1app::workspace:npub1workspace');
    expect(url.searchParams.get('channelid')).toBe('channel-1');
    expect(url.searchParams.get('threadid')).toBe('thread-1');
  });

  it('routes document comments to doc and comment params', async () => {
    const notification = await dispatchPush({
      target: {
        type: 'doc_comment',
        workspaceSlug: 'pete',
        docId: 'doc-1',
        commentId: 'comment-1',
      },
    });

    const url = new URL(notification.options.data.url);
    expect(url.pathname).toBe('/pete/docs');
    expect(url.searchParams.get('docid')).toBe('doc-1');
    expect(url.searchParams.get('commentid')).toBe('comment-1');
  });

  it('routes task comments and task assignments to task params', async () => {
    const commentNotification = await dispatchPush({
      target: {
        type: 'comment',
        workspace_slug: 'pete',
        task_id: 'task-1',
        comment_id: 'comment-1',
      },
    });
    const assignmentNotification = await dispatchPush({
      target: {
        type: 'task_assignment',
        workspace_slug: 'pete',
        scope_id: 'scope-1',
        task_id: 'task-2',
      },
    });

    const commentUrl = new URL(commentNotification.options.data.url);
    const assignmentUrl = new URL(assignmentNotification.options.data.url);
    expect(commentUrl.pathname).toBe('/pete/tasks');
    expect(commentUrl.searchParams.get('taskid')).toBe('task-1');
    expect(commentUrl.searchParams.get('commentid')).toBe('comment-1');
    expect(assignmentUrl.pathname).toBe('/pete/tasks');
    expect(assignmentUrl.searchParams.get('scopeid')).toBe('scope-1');
    expect(assignmentUrl.searchParams.get('taskid')).toBe('task-2');
  });
});
