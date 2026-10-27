import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { pullCopy } from '../copy';

/** How far to pull before letting go refreshes, and the furthest the indicator travels. */
export const PULL_THRESHOLD = 72;
const PULL_MAX = 110;

/**
 * Pull down from the top of the page to refresh, as on a phone. It only starts when the page is scrolled to
 * the top and the finger moves mostly downwards, and does nothing with a mouse or keyboard (the lists refresh
 * on their own when you come back to the app, and FridgeStock and Home reload when you open them).
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const distance = useRef(0);
  const busy = useRef(false);
  const refresh = useRef(onRefresh);
  useEffect(() => {
    refresh.current = onRefresh;
  });

  useEffect(() => {
    const begin = (event: TouchEvent) => {
      // Only from the very top, and never over a dialog.
      startY.current =
        window.scrollY <= 0 && !document.querySelector('[role="dialog"]') ? event.touches[0]!.clientY : null;
      distance.current = 0;
    };
    const drag = (event: TouchEvent) => {
      if (startY.current === null || busy.current) return;
      const delta = event.touches[0]!.clientY - startY.current;
      if (delta <= 0) {
        distance.current = 0;
        setPull(0);
        return;
      }
      distance.current = Math.min(PULL_MAX, delta * 0.6);
      setPull(distance.current);
    };
    const end = async () => {
      const pulled = distance.current;
      startY.current = null;
      distance.current = 0;
      if (pulled < PULL_THRESHOLD * 0.6 || busy.current) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(PULL_THRESHOLD * 0.6);
      try {
        await refresh.current();
      } finally {
        busy.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };
    document.addEventListener('touchstart', begin, { passive: true });
    document.addEventListener('touchmove', drag, { passive: true });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => {
      document.removeEventListener('touchstart', begin);
      document.removeEventListener('touchmove', drag);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
  }, []);

  return (
    <>
      <div
        aria-hidden={!refreshing}
        role={refreshing ? 'status' : undefined}
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center"
        style={{ transform: `translateY(${pull - 40}px)`, opacity: pull > 8 || refreshing ? 1 : 0 }}
      >
        <span className="mt-3 grid size-10 place-items-center rounded-full border border-line bg-card text-brand shadow-md">
          <RefreshCw className={`size-5 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />
          {refreshing && <span className="sr-only">{pullCopy.refreshing}</span>}
        </span>
      </div>
      {children}
    </>
  );
}
