import { Check, Trash2 } from 'lucide-react';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { swipeCopy } from '../copy';

/** How far to drag before letting go counts as a choice, and how far the card follows the finger. */
export const SWIPE_THRESHOLD = 96;
const SWIPE_MAX = 144;
/** The drag has to be mostly sideways to start (otherwise the page scrolls as usual). */
const START_DISTANCE = 10;

/**
 * Swipe a card right for "Used" and left for "Wasted". The two actions are drawn underneath, with an icon and
 * a word (not just a colour), and show while the card is being dragged. Swiping is a shortcut only: every
 * action also has a visible button, so it is never required, and it works with a mouse as well as a finger.
 * Vertical scrolling is untouched (`touch-pan-y`).
 */
export function SwipeActions({
  onUsed,
  onWasted,
  disabled = false,
  children,
}: {
  onUsed: () => void;
  onWasted: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const offset = useRef(0);

  const reset = () => {
    start.current = null;
    offset.current = 0;
    setDragging(false);
    setDx(0);
  };

  function down(event: PointerEvent<HTMLDivElement>) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    start.current = { x: event.clientX, y: event.clientY };
    moved.current = false;
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const from = start.current;
    if (!from) return;
    const deltaX = event.clientX - from.x;
    const deltaY = event.clientY - from.y;
    if (!dragging) {
      if (Math.abs(deltaY) > START_DISTANCE && Math.abs(deltaY) > Math.abs(deltaX)) {
        start.current = null; // the person is scrolling
        return;
      }
      if (Math.abs(deltaX) < START_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    moved.current = true;
    offset.current = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, deltaX));
    setDx(offset.current);
  }

  function up() {
    const finished = offset.current;
    const wasDragging = dragging;
    reset();
    if (!wasDragging) return;
    if (finished >= SWIPE_THRESHOLD) onUsed();
    else if (finished <= -SWIPE_THRESHOLD) onWasted();
  }

  return (
    <div className="relative">
      {/* The actions underneath. Hidden from everything until a drag shows one. */}
      <div
        aria-hidden
        className={`absolute inset-0 flex items-center px-5 text-base font-semibold ${
          dx > 0 ? 'justify-start bg-ok text-ok-ink' : dx < 0 ? 'justify-end bg-past text-past-ink' : 'invisible'
        }`}
      >
        {dx > 0 && (
          <span className="flex items-center gap-2">
            <Check className="size-6" strokeWidth={2.5} />
            {swipeCopy.used}
          </span>
        )}
        {dx < 0 && (
          <span className="flex items-center gap-2">
            {swipeCopy.wasted}
            <Trash2 className="size-6" strokeWidth={2.2} />
          </span>
        )}
      </div>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={reset}
        onClickCapture={(event) => {
          // A drag that ended on the card's link must not also open it.
          if (moved.current) {
            event.preventDefault();
            event.stopPropagation();
            moved.current = false;
          }
        }}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        className={`relative touch-pan-y bg-card ${dragging ? 'select-none' : 'transition-transform duration-200'}`}
      >
        {children}
      </div>
    </div>
  );
}
