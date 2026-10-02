import { createElement } from 'react';
import { foodIcon } from '../lib/foodIcon';
import { FoodPhoto } from '../lib/foodPhoto';

/**
 * A food's picture: its photo thumbnail when it has one, otherwise an icon for its kind of food (carrot,
 * milk, egg, fish, beef and so on) on a soft tile. The icon is decoration: the name is always written next to it.
 */
export function FoodThumb({
  foodId,
  photoAt,
  name,
  className = 'size-16',
}: {
  foodId: string;
  photoAt: string | null;
  name: string;
  /** Size and any extra classes. */
  className?: string;
}) {
  if (photoAt) {
    return (
      <FoodPhoto
        foodId={foodId}
        photoAt={photoAt}
        name={name}
        size="thumb"
        className={`shrink-0 rounded-button object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-button bg-brand-soft text-brand ${className}`}
    >
      {createElement(foodIcon(name), { className: 'size-1/2', strokeWidth: 1.75 })}
    </span>
  );
}
