import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/**
 * Runs the real public/sw.js in a sandbox with a fake `self`, and taps a notification's button. The worker has
 * no login of its own: a refused action token (expired, or already used by a first tap) must only open the
 * item, never sign anyone out.
 */
const SOURCE = readFileSync(path.resolve('public/sw.js'), 'utf8');

function startWorker(statuses: number[]) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const page = {
    url: 'https://app.test/',
    focus: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    postMessage: vi.fn(),
  };
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = statuses[calls.length - 1] ?? 204;
    return { ok: status >= 200 && status < 300, status };
  });
  const self = {
    location: { href: 'https://app.test/sw.js?api=https://api.test/api', origin: 'https://app.test' },
    addEventListener: (type: string, handler: (event: unknown) => void) => (handlers[type] = handler),
    clients: { matchAll: vi.fn(async () => [page]), openWindow: vi.fn(async () => {}), claim: async () => {} },
    registration: { showNotification: vi.fn(async () => {}) },
    skipWaiting: () => {},
  };
  vm.runInNewContext(SOURCE, { self, fetch, URL, JSON, console });

  async function tap(action: string) {
    let done: Promise<unknown> = Promise.resolve();
    handlers.notificationclick!({
      action,
      notification: { data: { url: '/food/1', actionToken: 'tok', actionUrls: {} }, close: () => {} },
      waitUntil: (promise: Promise<unknown>) => (done = promise),
    });
    await done;
  }
  return { tap, calls, page, self };
}

describe('the service worker’s notification buttons', () => {
  it('a double tap: the first Used goes through quietly, the second (a 401) just opens the item', async () => {
    const worker = startWorker([204, 401]);

    await worker.tap('USED');
    expect(worker.page.navigate).not.toHaveBeenCalled();

    await worker.tap('USED');
    expect(worker.calls).toHaveLength(2);
    expect(worker.page.navigate).toHaveBeenCalledWith('https://app.test/food/1');

    // Only the action token is sent, never a login, and no page is told anything (so nothing signs out).
    for (const { url, init } of worker.calls) {
      expect(url).toBe('https://api.test/api/push/actions');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body as string)).toEqual({ token: 'tok', action: 'USED' });
    }
    expect(worker.page.postMessage).not.toHaveBeenCalled();
  });

  it('an expired token opens the item the same way, in a new window when none is open', async () => {
    const worker = startWorker([401]);
    worker.self.clients.matchAll.mockResolvedValue([]);
    await worker.tap('SNOOZE');
    expect(worker.self.clients.openWindow).toHaveBeenCalledWith('https://app.test/food/1');
  });
});
