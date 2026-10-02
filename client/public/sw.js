/* Cook First service worker: shows push reminders and handles their buttons.
 *
 * Every word shown comes from the server in the push payload, so this file
 * holds no wording of its own. The API address comes from the registration URL
 * (/sw.js?api=...), set in src/lib/push.ts.
 *
 * Sound and vibration come from the payload too (the server decides them from the person's settings and
 * quiet hours): a vibration pattern, `requireInteraction` for due and overdue reminders so they stay until
 * acted on, and `silent` for quiet hours. A repeat reminder has the same `tag`, so it replaces the earlier one.
 * No full-screen alarms and nothing that rings on.
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
  event.waitUntil(show(data));
});

async function show(data) {
  // Browsers without notification buttons still get the reminder; tapping it opens the page.
  const supportsActions = 'actions' in Notification.prototype && Notification.maxActions > 0;

  // An open page plays its own chime (after the person has touched it), so the notification stays quiet then.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = windows.filter((client) => client.visibilityState === 'visible');
  for (const client of visible) client.postMessage({ type: 'cook-first:reminder', kind: data.kind || null });

  const silent = data.silent === true || visible.length > 0;
  const buttons = Array.isArray(data.actions) ? data.actions : [];
  // The buttons that open a page (like "Cooked it") carry its address; the others call the API.
  const actionUrls = {};
  for (const button of buttons) if (button.url) actionUrls[button.action] = button.url;

  await self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // A vibration pattern may not be combined with silent.
    vibrate: !silent && Array.isArray(data.vibrate) && data.vibrate.length ? data.vibrate : undefined,
    requireInteraction: data.requireInteraction === true,
    silent,
    // A reminder that replaces an earlier one (same tag) alerts again, unless it is silent.
    renotify: !silent,
    data: { url: data.url || '/', actionToken: data.actionToken || null, actionUrls },
    actions:
      supportsActions && data.actionToken
        ? buttons.map((button) => ({ action: button.action, title: button.title }))
        : [],
  });
}

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const { url, actionToken, actionUrls } = notification.data || {};
  notification.close();
  event.waitUntil(handleClick(event.action, url || '/', actionToken, actionUrls || {}));
});

/**
 * A button that opens a page ("Cooked it", "Show recipe") opens it. "Used", "Snooze" and "Snooze 30 min" call the
 * API; if that fails for any reason, the page opens instead.
 */
async function handleClick(action, url, actionToken, actionUrls) {
  if (action && actionUrls[action]) {
    await openPage(actionUrls[action]);
    return;
  }
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
