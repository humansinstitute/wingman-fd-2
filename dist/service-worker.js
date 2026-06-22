
const BUILD_ID = "20260622-0550-15-1312";
const CACHE_PREFIX = 'wingman-fd';
const CACHE_NAME = `${CACHE_PREFIX}-${BUILD_ID}`;
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/wingman-logo-192x192.png',
  '/wingman-logo-512x512.png',
  '/wingman-logo.png',
  '/version.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function parsePushPayload(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    try {
      return { body: event.data?.text?.() || '' };
    } catch {
      return {};
    }
  }
}

function pushTargetUrl(payload = {}) {
  const directUrl = String(payload.url || payload.click_url || payload.clickUrl || '').trim();
  if (directUrl) return new URL(directUrl, self.location.origin).toString();

  const target = payload.target && typeof payload.target === 'object' ? payload.target : payload;
  const workspaceSlug = String(payload.workspace_slug || target.workspace_slug || target.workspaceSlug || '').trim();
  const workspaceKey = String(payload.workspace_key || target.workspace_key || target.workspaceKey || '').trim();
  const section = String(target.section || target.surface || target.type || '').trim().toLowerCase();
  const hasTaskTarget = Boolean(target.task_id || target.taskId);
  const hasDocumentTarget = Boolean(target.doc_id || target.document_id || target.docId || target.documentId);
  const routeSection = section === 'dm' || section === 'thread' || section === 'message' || section === 'chat'
    ? 'chat'
    : section === 'task' || section === 'task_assignment' || section === 'task_comment' || (section === 'comment' && hasTaskTarget)
      ? 'tasks'
      : section === 'document' || section === 'doc' || section === 'doc_comment' || section === 'document_comment' || (section === 'comment' && hasDocumentTarget)
        ? 'docs'
        : 'flight-deck';
  const path = workspaceSlug ? `/${encodeURIComponent(workspaceSlug)}/${routeSection}` : `/${routeSection}`;
  const url = new URL(path, self.location.origin);
  if (workspaceKey) url.searchParams.set('workspacekey', workspaceKey);
  const scopeId = String(target.scope_id || target.scopeId || '').trim();
  if (scopeId) url.searchParams.set('scopeid', scopeId);
  const channelId = String(target.channel_id || target.channelId || '').trim();
  const threadId = String(target.thread_id || target.threadId || target.message_id || target.messageId || '').trim();
  const docId = String(target.doc_id || target.document_id || target.docId || target.documentId || '').trim();
  const commentId = String(target.comment_id || target.commentId || '').trim();
  const taskId = String(target.task_id || target.taskId || '').trim();
  if (routeSection === 'chat') {
    if (channelId) url.searchParams.set('channelid', channelId);
    if (threadId) url.searchParams.set('threadid', threadId);
  } else if (routeSection === 'docs') {
    if (docId) url.searchParams.set('docid', docId);
    if (commentId) url.searchParams.set('commentid', commentId);
  } else if (routeSection === 'tasks') {
    if (taskId) url.searchParams.set('taskid', taskId);
    if (commentId) url.searchParams.set('commentid', commentId);
  }
  return url.toString();
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);
  const title = String(payload.title || 'Flight Deck').trim();
  const body = String(payload.body || payload.message || '').trim();
  const notificationOptions = {
    body,
    icon: payload.icon || '/wingman-logo-192x192.png',
    badge: payload.badge || '/wingman-logo-192x192.png',
    tag: payload.tag || payload.dedupe_key || undefined,
    data: {
      url: pushTargetUrl(payload),
      target: payload.target || null,
    },
  };
  event.waitUntil(self.registration.showNotification(title, notificationOptions));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || self.location.origin;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(targetUrl, self.location.origin);
    for (const client of windows) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin !== target.origin) continue;
      await client.focus();
      client.navigate?.(target.toString());
      return;
    }
    await self.clients.openWindow(target.toString());
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const appShell = await cache.match('/index.html');
    if (appShell) return appShell;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => undefined);
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/version.json') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/assets/') || PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
