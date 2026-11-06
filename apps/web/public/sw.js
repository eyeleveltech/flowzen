/*
 * No `fetch` listener here, on purpose (Perf Plan 1, decision 9).
 *
 * There used to be an empty one, "required for the install prompt". It was
 * not: Chrome has not needed a fetch handler to offer "Install app" for some
 * time, and an empty one cost something on every request — the browser had
 * to wake the worker up and ask it whether it wanted the request, for a
 * handler that never did. Push and the tap on a notification are all this
 * worker is for.
 *
 * If a cache is ever added here: it must EXCLUDE /api/credentials* — those
 * answers carry passwords and are sent with Cache-Control: no-store
 * (Credentials plan, decision 10). Nothing from Logins may sit in a cache.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * Phone notifications.
 *
 * The server (workers/push.cron.ts) sends { title, body, url, tag }: a title
 * and one line, never a money figure, and the page it is about. `tag` is the
 * outbox row, so a push that arrives twice shows once.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Flowzen', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag,
      data: { url: data.url || '/my-work' },
    }),
  );
});

/*
 * Tapping one opens the page it is about — in the Flowzen window already open
 * if there is one (the page navigates itself, see components/providers.tsx),
 * otherwise in a new one. Only ever a page of Flowzen's own.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/my-work';
  const target = new URL(path, self.location.origin);
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({ type: 'flowzen:navigate', url: target.pathname + target.search + target.hash });
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
