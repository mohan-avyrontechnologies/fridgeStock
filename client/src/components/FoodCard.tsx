import { formatDisplay, type ActiveFoodItem } from '@cook-first/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { cardExpiryLine, remainingText, urgencyCopy } from '../copy';
import { formatQuantity } from '../lib/format';
import { ActionSheet, type SheetStep } from './ActionSheet';
import { URGENCY_STYLE, UrgencyBadge } from './Urgency';

/**
 * One active item: name, urgency (colour and label), quantity and unit,
 * remaining days, expected expiry and notes, with "Used" (all or some) and
 * "Wasted" buttons.
 */
export function FoodCard({ item }: { item: ActiveFoodItem }) {
  const [sheet, setSheet] = useState<SheetStep | null>(null);
  const remaining = remainingText(item.remainingDays);
  return (
    <li className="relative flex overflow-hidden rounded-2xl border border-line bg-card">
      <span aria-hidden className={`w-1.5 shrink-0 ${URGENCY_STYLE[item.urgency].bar}`} />
      <div className="min-w-0 flex-1">
        <Link to={`/food/${item.id}`} className="block px-3.5 pt-3 pb-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-base font-semibold text-ink">{item.name}</span>
            <UrgencyBadge urgency={item.urgency} />
          </div>
          <p className="mt-1 text-sm text-ink">
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
        </Link>
        <div className="flex gap-2 px-3.5 pb-3">
          <button
            type="button"
            onClick={() => setSheet('used')}
            className="min-h-11 flex-1 rounded-xl border border-line text-sm font-semibold text-brand hover:bg-brand-soft"
            aria-label={`Used: ${item.name}`}
          >
            Used
          </button>
          <button
            type="button"
            onClick={() => setSheet({ confirm: 'WASTED' })}
            className="min-h-11 flex-1 rounded-xl border border-line text-sm font-semibold text-danger hover:bg-past/40"
            aria-label={`Wasted: ${item.name}`}
          >
            Wasted
          </button>
        </div>
      </div>
      {sheet && <ActionSheet item={item} initialStep={sheet} onClose={() => setSheet(null)} />}
    </li>
  );
}

export function FoodList({ items, columns = 1 }: { items: ActiveFoodItem[]; columns?: 1 | 2 }) {
  return (
    <ul className={columns === 2 ? 'grid gap-2.5 lg:grid-cols-2' : 'space-y-2.5'}>
      {items.map((item) => (
        <FoodCard key={item.id} item={item} />
      ))}
    </ul>
  );
}
