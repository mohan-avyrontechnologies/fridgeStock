import { useState } from 'react';
import { Link } from 'react-router';
import type { ActiveFoodItem } from '../api/types';
import { relativeDay } from '../copy';
import { formatDateKey, formatQuantity } from '../lib/dates';
import { ActionSheet } from './ActionSheet';
import { URGENCY_STYLE, UrgencyBadge } from './Urgency';

export function FoodCard({ item }: { item: ActiveFoodItem }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <li className="relative flex overflow-hidden rounded-2xl border border-line bg-card">
      <span aria-hidden className={`w-1.5 shrink-0 ${URGENCY_STYLE[item.urgency].bar}`} />
      <Link to={`/food/${item.id}`} className="min-w-0 flex-1 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-base font-semibold text-ink">{item.name}</span>
          <UrgencyBadge urgency={item.urgency} />
        </div>
        <p className="mt-1 text-sm text-ink">{formatQuantity(item.quantity, item.unit)}</p>
        <p className="text-sm text-muted">
          Expected expiry {formatDateKey(item.expectedExpiryDate)} · {relativeDay(item.remainingDays)}
        </p>
      </Link>
      <div className="flex items-center pr-3">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="min-h-11 rounded-xl border border-line px-3 text-sm font-semibold text-brand hover:bg-brand-soft"
          aria-label={`Update ${item.name}`}
        >
          Update
        </button>
      </div>
      {sheetOpen && <ActionSheet item={item} onClose={() => setSheetOpen(false)} />}
    </li>
  );
}

export function FoodList({ items }: { items: ActiveFoodItem[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <FoodCard key={item.id} item={item} />
      ))}
    </ul>
  );
}
