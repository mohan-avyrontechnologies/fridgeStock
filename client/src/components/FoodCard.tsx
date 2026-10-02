import { formatDisplay, type ActiveFoodItem } from '@cook-first/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { cardExpiryLine, leftoverCopy, remainingText, urgencyCopy } from '../copy';
import { formatQuantity } from '../lib/format';
import { ActionSheet, useFoodActions, type SheetStep } from './ActionSheet';
import { FoodThumb } from './FoodThumb';
import { Card } from './ui';
import { URGENCY_STYLE, UrgencyBadge } from './Urgency';

/**
 * One active item: its photo or category icon, a large name, quantity and unit, remaining days with the
 * urgency badge, and the expected expiry date, with "Used" (all or some) and "Wasted" buttons. Wasted
 * happens at once, with "Undo" in the toast.
 */
export function FoodCard({ item }: { item: ActiveFoodItem }) {
  const [sheet, setSheet] = useState<SheetStep | null>(null);
  const run = useFoodActions();
  const remaining = remainingText(item.remainingDays);
  return (
    <Card as="li" className="relative flex overflow-hidden">
      <span aria-hidden className={`w-1.5 shrink-0 ${URGENCY_STYLE[item.urgency].bar}`} />
      <div className="min-w-0 flex-1">
        <Link to={`/food/${item.id}`} className="flex gap-4 px-4 pt-4 pb-2">
          <FoodThumb foodId={item.id} photoAt={item.photoAt} name={item.name} className="size-16" />
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
            <p className="text-sm text-muted">{cardExpiryLine(formatDisplay(item.expiryDate))}</p>
            {item.notes && <p className="mt-0.5 truncate text-sm text-muted italic">{item.notes}</p>}
          </div>
        </Link>
        <div className="flex gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={() => setSheet('used')}
            className="min-h-12 flex-1 rounded-button border border-field text-base font-semibold text-brand hover:bg-brand-soft"
            aria-label={`Used: ${item.name}`}
          >
            Used
          </button>
          <button
            type="button"
            onClick={() => void run(item, 'WASTED')}
            className="min-h-12 flex-1 rounded-button border border-field text-base font-semibold text-danger hover:bg-past"
            aria-label={`Wasted: ${item.name}`}
          >
            Wasted
          </button>
        </div>
      </div>
      {sheet && <ActionSheet item={item} initialStep={sheet} onClose={() => setSheet(null)} />}
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
