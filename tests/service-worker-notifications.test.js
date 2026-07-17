import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { buildServiceWorkerSource } from '../vite.config.js';

function loadServiceWorkerHarness({ clients, cacheNames = [] } = {}) {
  const handlers = new Map();
  const shownNotifications = [];
  const deletedCaches = [];
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
      async keys() { return cacheNames; },
      async delete(name) {
        deletedCaches.push(name);
        return true;
      },
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
        async claim() {},
        async matchAll() { return clients || []; },
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
  return { deletedCaches, handlers, shownNotifications };
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
  it('reloads app windows when a new build replaces an older Flight Deck cache', async () => {
    const navigations = [];
    const client = {
      url: 'https://flightdeck.example/pete/workroom/room-1',
      async navigate(url) {
        navigations.push(url);
        return null;
      },
    };
    const { deletedCaches, handlers } = loadServiceWorkerHarness({
      cacheNames: ['wingman-fd-old-build', 'unrelated-cache'],
      clients: [client],
    });
    const waits = [];

    handlers.get('activate')({
      waitUntil(promise) {
        waits.push(promise);
      },
    });
    await Promise.all(waits);

    expect(deletedCaches).toEqual(['wingman-fd-old-build']);
    expect(navigations).toEqual(['https://flightdeck.example/pete/workroom/room-1']);
  });

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

  it('routes Tower chat notification payloads without target type metadata', async () => {
    const notification = await dispatchPush({
      title: 'Flight Deck: Pete',
      body: 'Thread Update in Implementation',
      route: '/workspaces/workspace-1/channels/channel-1/threads/thread-1',
      category: 'chat_thread',
      workspace_id: 'workspace-1',
      target: {
        channel_id: 'channel-1',
        thread_id: 'thread-1',
      },
    });

    const url = new URL(notification.options.data.url);
    expect(url.pathname).toBe('/chat');
    expect(url.searchParams.get('workspaceid')).toBe('workspace-1');
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

  it('posts notification click routes into an already open app window', async () => {
    const messages = [];
    const navigations = [];
    let focused = false;
    const client = {
      url: 'https://flightdeck.example/pete/flight-deck',
      postMessage(message) {
        messages.push(message);
      },
      async navigate(url) {
        navigations.push(url);
        return null;
      },
      async focus() {
        focused = true;
      },
    };
    const { handlers } = loadServiceWorkerHarness({ clients: [client] });
    const waits = [];

    handlers.get('notificationclick')({
      notification: {
        close() {},
        data: { url: 'https://flightdeck.example/chat?workspaceid=workspace-1&channelid=channel-1&threadid=thread-1' },
      },
      waitUntil(promise) {
        waits.push(promise);
      },
    });
    await Promise.all(waits);

    expect(messages).toEqual([{
      type: 'flightdeck:notification-click',
      url: 'https://flightdeck.example/chat?workspaceid=workspace-1&channelid=channel-1&threadid=thread-1',
    }]);
    expect(navigations).toEqual(['https://flightdeck.example/chat?workspaceid=workspace-1&channelid=channel-1&threadid=thread-1']);
    expect(focused).toBe(true);
  });
});
