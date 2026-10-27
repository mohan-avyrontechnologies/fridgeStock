import { formatDisplay, type ActiveFoodItem } from '@fridgestock/shared';
import { Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { expirySourceLabel } from '@fridgestock/shared';
import { cardExpiryLine, leftoverCopy, remainingText, swipeCopy, urgencyCopy } from '../copy';
import { formatQuantity } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import { useToastStore } from '../stores/toastStore';
import { ActionSheet, useFoodActions, type SheetStep } from './ActionSheet';
import { FoodThumb } from './FoodThumb';
import { SwipeActions } from './SwipeActions';
import { Card } from './ui';
import { URGENCY_STYLE, UrgencyBadge } from './Urgency';

/** How long the "used" animation takes (a short check mark, then the card closes up). Keep in step with index.css. */
export const COLLAPSE_MS = 380;

/**
 * One active item: its photo or category icon, a large name, quantity and unit, remaining days with the
 * urgency badge, and the expected expiry date. It only ever shows the time left as words and the badge:
 * no meter, ring or bar.
 *
 * Marking it as used or wasted happens at once, with "Undo" in the toast, by the visible buttons or by
 * swiping the card (right for used, left for wasted). Used closes the card with a short check mark, unless
 * the person prefers reduced motion.
 */
export function FoodCard({ item }: { item: ActiveFoodItem }) {
  const [sheet, setSheet] = useState<SheetStep | null>(null);
  const [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLLIElement>(null);
  const run = useFoodActions();
  const toast = useToastStore((s) => s.show);
  const remaining = remainingText(item.remainingDays);

  async function markUsed() {
    if (leaving) return;
    const element = card.current;
    if (element && !prefersReducedMotion()) {
      element.style.setProperty('--card-height', `${element.offsetHeight}px`);
      setLeaving(true);
      await new Promise((resolve) => setTimeout(resolve, COLLAPSE_MS));
    }
    try {
      await run(item, 'USED');
    } catch {
      setLeaving(false);
      toast(`Couldn’t mark ${item.name} as used. Check your connection and try again.`);
    }
  }

  async function markWasted() {
    if (leaving) return;
    try {
      await run(item, 'WASTED');
    } catch {
      toast(`Couldn’t mark ${item.name} as wasted. Check your connection and try again.`);
    }
  }

  return (
    <Card as="li" ref={card} className={`@container relative overflow-hidden ${leaving ? 'card-collapse' : ''}`}>
      <SwipeActions disabled={leaving} onUsed={() => void markUsed()} onWasted={() => void markWasted()}>
        <div className="flex">
          <span aria-hidden className={`w-1.5 shrink-0 ${URGENCY_STYLE[item.urgency].bar}`} />
          <div className="min-w-0 flex-1">
            <Link
              to={`/food/${item.id}`}
              draggable={false}
              className="flex flex-col gap-3 px-4 pt-4 pb-2 @min-[18rem]:flex-row @min-[18rem]:gap-4"
            >
              <FoodThumb foodId={item.id} photoAt={item.photoAt} name={item.name} className="size-[64px]" />
              <div className="min-w-0 flex-1">
                <h3 className="text-xl leading-tight font-semibold text-ink">{item.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <UrgencyBadge urgency={item.urgency} />
                  {item.leftover && (
                    <span className="rounded-full bg-calm px-2.5 py-1 text-xs font-semibold text-calm-ink">
                      {leftoverCopy.tag}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-base text-ink">
                  {formatQuantity(item.quantity, item.unit)}
                  {/* When due today the badge already says "Expected expiry today". */}
                  {remaining !== urgencyCopy[item.urgency].label && (
                    <>
                      {' · '}
                      <span className="font-medium">{remaining}</span>
                    </>
                  )}
                </p>
                <p className="text-sm text-muted">
                  {cardExpiryLine(formatDisplay(item.expiryDate), expirySourceLabel(item.expirySource))}
                </p>
                {item.notes && <p className="mt-0.5 break-words text-sm text-muted italic">{item.notes}</p>}
              </div>
            </Link>
            <div className="flex gap-2 px-4 pb-4">
              <button
                type="button"
                onClick={() => setSheet('used')}
                className="min-h-12 min-w-0 flex-1 rounded-button border border-field px-2 py-2 text-base leading-tight font-semibold text-brand hover:bg-brand-soft"
                aria-label={`${swipeCopy.used}: ${item.name}`}
              >
                {swipeCopy.used}
              </button>
              <button
                type="button"
                onClick={() => void markWasted()}
                className="min-h-12 min-w-0 flex-1 rounded-button border border-field px-2 py-2 text-base leading-tight font-semibold text-danger hover:bg-past"
                aria-label={`${swipeCopy.wasted}: ${item.name}`}
              >
                {swipeCopy.wasted}
              </button>
            </div>
          </div>
        </div>
      </SwipeActions>
      {leaving && (
        <span aria-hidden className="check-pop absolute inset-0 grid place-items-center bg-ok/90 text-ok-ink">
          <Check className="size-10" strokeWidth={3} />
        </span>
      )}
      {sheet && (
        <ActionSheet
          item={item}
          initialStep={sheet}
          onClose={() => setSheet(null)}
          onUsedAll={() => {
            setSheet(null);
            void markUsed();
          }}
        />
      )}
    </Card>
  );
}

export function FoodList({ items, columns = 1 }: { items: ActiveFoodItem[]; columns?: 1 | 2 }) {
  return (
    <ul className={columns === 2 ? 'grid gap-3 lg:grid-cols-2' : 'space-y-3'}>
      {items.map((item) => (
        <FoodCard key={item.id} item={item} />
      ))}
    </ul>
  );
}
