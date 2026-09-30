/* Cook First service worker: shows push reminders and handles their buttons.
 *
 * Every word shown comes from the server in the push payload, so this file
 * holds no wording of its own. The API address comes from the registration URL
 * (/sw.js?api=...), set in src/lib/push.ts.
 */
const API_URL = new URL(self.location.href).searchParams.get('api');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || !data.title) return;
  // Browsers without notification buttons still get the reminder; tapping it opens the page.
  const supportsActions = 'actions' in Notification.prototype && Notification.maxActions > 0;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/', actionToken: data.actionToken || null },
      actions: supportsActions && data.actionToken ? data.actions || [] : [],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const { url, actionToken } = notification.data || {};
  notification.close();
  event.waitUntil(handleClick(event.action, url || '/', actionToken));
});

/** "Used" or "Snooze" calls the API; if that fails for any reason, Food Details opens instead. */
async function handleClick(action, url, actionToken) {
  if (action && actionToken && API_URL) {
    try {
      const res = await fetch(`${API_URL}/push/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: actionToken, action }),
      });
      if (res.ok) return;
    } catch {
      // Offline or the API is down: fall through to opening the page.
    }
  }
  await openPage(url);
}

async function openPage(url) {
  const target = new URL(url, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
      await client.focus();
      if ('navigate' in client) await client.navigate(target);
      return;
    }
  }
  await self.clients.openWindow(target);
}
