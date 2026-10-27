import { formatDisplay, type ActiveFoodItem, type MealPlan, type MealType } from '@fridgestock/shared';
import { Utensils } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { homeCopy, mealPageCopy, remainingText, urgencyCopy } from '../copy';
import { FoodThumb } from './FoodThumb';
import { Button, Card, EmptyState, SectionTitle } from './ui';
import { URGENCY_STYLE, UrgencyBadge } from './Urgency';

/** How many urgent items the panel shows, most urgent first. */
export const TODAY_ITEMS = 6;

/** What to cook for this meal: today's planned meal, or a nudge to start with the most urgent food. */
function suggestion(meal: MealType, plan: MealPlan | null, items: ActiveFoodItem[]): string | null {
  const today = plan?.days[0];
  const planned = today?.meals?.[meal] ?? (meal === 'dinner' ? today?.entry : null);
  if (planned) return homeCopy.planned(mealPageCopy.mealNames[meal].toLowerCase(), planned.title);
  if (items.length === 0) return null;
  return homeCopy.startWith(
    mealPageCopy.mealNames[meal].toLowerCase(),
    items.slice(0, 2).map((item) => item.name),
  );
}

function TodayCard({ item }: { item: ActiveFoodItem }) {
  const remaining = remainingText(item.remainingDays);
  return (
    <Card as="li" className="relative w-[min(16rem,80vw)] shrink-0 snap-start overflow-hidden">
      <span aria-hidden className={`block h-1.5 ${URGENCY_STYLE[item.urgency].bar}`} />
      <Link to={`/food/${item.id}`} className="block space-y-3 p-4">
        <FoodThumb foodId={item.id} photoAt={item.photoAt} name={item.name} className="h-24 w-full" />
        <h3 className="break-words text-xl leading-tight font-semibold text-ink">{item.name}</h3>
        <UrgencyBadge urgency={item.urgency} />
        <p className="text-base text-ink">
          {/* When due today the badge already says "Expected expiry today". */}
          {remaining !== urgencyCopy[item.urgency].label ? (
            <span className="font-medium">{remaining}</span>
          ) : (
            <span className="text-muted">{homeCopy.expectedOn(formatDisplay(item.expiryDate))}</span>
          )}
        </p>
      </Link>
    </Card>
  );
}

/**
 * The top of Home: the most urgent food as large cards in a row you can scroll sideways, what to cook for the
 * current meal, and a "Cooked something" button. With nothing urgent it is a calm message with two ways forward.
 * Everything here only reads the FridgeStock order.
 */
export function FridgeStockToday({
  items,
  meal,
  plan,
}: {
  items: ActiveFoodItem[];
  meal: MealType;
  plan: MealPlan | null;
}) {
  const navigate = useNavigate();
  const text = suggestion(meal, plan, items);
  return (
    <section aria-labelledby="fridgestock-today" className="space-y-3">
      <SectionTitle
        id="fridgestock-today"
        action={
          items.length > 0 && (
            <Link to="/fridgestock" className="inline-flex min-h-12 items-center text-sm font-semibold text-brand">
              {homeCopy.seeAll}
            </Link>
          )
        }
      >
        {homeCopy.title}
      </SectionTitle>

      {items.length === 0 ? (
        <EmptyState
          title={homeCopy.calmTitle}
          action={
            <>
              <Button variant="secondary" onClick={() => navigate('/plan')}>
                {homeCopy.planMeal}
              </Button>
              <Button onClick={() => navigate('/add')}>{homeCopy.addFood}</Button>
            </>
          }
        >
          {homeCopy.calmBody}
        </EmptyState>
      ) : (
        <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2" aria-label={homeCopy.rowLabel}>
          {items.slice(0, TODAY_ITEMS).map((item) => (
            <TodayCard key={item.id} item={item} />
          ))}
        </ul>
      )}

      {(text || items.length > 0) && (
        <Card className="flex items-center gap-3 p-4">
          <Utensils aria-hidden className="size-6 shrink-0 text-brand" strokeWidth={1.9} />
          <p className="min-w-0 flex-1 text-base text-ink">{text ?? homeCopy.noSuggestion}</p>
        </Card>
      )}

      <Button variant="secondary" className="w-full" onClick={() => navigate('/add?leftover=1')}>
        {homeCopy.cooked}
      </Button>
    </section>
  );
}
