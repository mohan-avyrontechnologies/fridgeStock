import {
  Apple,
  Banana,
  Beef,
  Carrot,
  Cherry,
  Citrus,
  Cookie,
  CookingPot,
  CupSoda,
  Drumstick,
  Egg,
  Fish,
  Grape,
  Ham,
  LeafyGreen,
  Milk,
  Package,
  Salad,
  Sandwich,
  Shrimp,
  Soup,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

/**
 * The picture shown for a food that has no photo: an icon for its kind of food, chosen from its name.
 * The first match wins, so the specific words (chicken) come before the general ones (meat). Anything
 * unrecognised gets a plain package.
 */
const KINDS: { icon: LucideIcon; words: RegExp }[] = [
  { icon: Egg, words: /\begg/ },
  { icon: Milk, words: /\b(milk|yoghurt|yogurt|cream|cheese|butter|kefir|paneer|custard|dairy)/ },
  { icon: Shrimp, words: /\b(prawn|shrimp|crab|lobster)/ },
  { icon: Fish, words: /\b(fish|salmon|tuna|cod|haddock|trout|sardine|mackerel|seafood)/ },
  { icon: Drumstick, words: /\b(chicken|turkey|duck|drumstick|wings?)\b/ },
  { icon: Ham, words: /\b(ham|bacon|sausage|salami|gammon|chorizo)/ },
  { icon: Beef, words: /\b(beef|steak|mince|lamb|pork|meat|burger|veal|mutton)/ },
  { icon: Carrot, words: /\b(carrot|parsnip|turnip|beetroot|radish|swede)/ },
  { icon: Salad, words: /\b(salad|lettuce|rocket|cucumber|celery|coleslaw)/ },
  {
    icon: LeafyGreen,
    words: /\b(spinach|kale|cabbage|broccoli|chard|herb|basil|coriander|parsley|mint|leek|greens|cauliflower|sprouts?)/,
  },
  { icon: Banana, words: /\bbanana/ },
  { icon: Cherry, words: /\b(cherr|strawberr|raspberr|blueberr|berr|plum)/ },
  { icon: Grape, words: /\bgrape/ },
  { icon: Citrus, words: /\b(lemon|lime|orange|grapefruit|satsuma|clementine|mandarin)/ },
  { icon: Apple, words: /\b(apple|pear|peach|mango|melon|fruit|tomato|pepper|avocado)/ },
  { icon: Sandwich, words: /\b(bread|toast|bun|roll|bagel|wrap|pitta|naan|sandwich|baguette|loaf)/ },
  { icon: Wheat, words: /\b(rice|pasta|noodle|flour|oats?|cereal|couscous|grain|tortilla)/ },
  { icon: Soup, words: /\b(soup|stew|curry|broth|chilli|dal|dhal|sauce|gravy)/ },
  { icon: CookingPot, words: /\b(leftover|cooked|casserole|lasagne|pie|bake)/ },
  { icon: Cookie, words: /\b(cake|biscuit|cookie|pastry|dessert|pudding|chocolate)/ },
  { icon: CupSoda, words: /\b(juice|drink|cola|soda|smoothie|squash)/ },
];

/** The icon for a food, from its name. */
export function foodIcon(name: string): LucideIcon {
  const lower = name.toLowerCase();
  return KINDS.find((kind) => kind.words.test(lower))?.icon ?? Package;
}
