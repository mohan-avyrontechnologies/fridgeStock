/**
 * Every user-facing sentence the server produces about expiry lives here, and
 * nowhere else (tests/foodSafetyCopy.test.ts checks).
 * Food-safety boundary (BRD §10.3): dates are planning estimates. Never claim
 * food is fit to eat; use "expected expiry" wording only.
 */

/** "1 day", "2 days". */
function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/** Reminder messages. {n} is worked out at the moment the reminder is sent. */
export const reminderCopy = {
  APPROACHING_EXPIRY: (name: string, remainingDays: number) =>
    `${name}: expected expiry in ${days(remainingDays)}. Consider using it soon.`,
  DUE: (name: string) => `${name}: expected expiry is today.`,
  OVERDUE: (name: string) => `${name} is past its expected expiry. Check it before using.`,
};

/** Push notifications (Phase 3). Per-item pushes reuse reminderCopy for their text. */
export const pushCopy = {
  title: 'Cook First',
  digestTitle: (count: number) => (count === 1 ? 'Cook First: 1 item to check' : `Cook First: ${count} items to check`),
  /** One line of the daily summary, in Cook First order. */
  digestLine: (name: string, remainingDays: number) => {
    if (remainingDays > 0) return `${name}: expected expiry in ${days(remainingDays)}`;
    if (remainingDays === 0) return `${name}: expected expiry today`;
    return `${name}: past its expected expiry`;
  },
  digestMore: (count: number) => `and ${count} more`,
  actions: { USED: 'Used', SNOOZE: 'Snooze' },
};

/** AI features (Phase 4): messages shown to the user. */
/** Sentences stored with an expected expiry that the app changed because the person asked it to. */
export const adjustedCopy = {
  photoCheck: 'You brought the expected expiry forward to today after a Photo Check.',
};

export const aiCopy = {
  notEnabled: 'AI suggestions aren’t turned on for this app.',
  failed: 'Couldn’t get suggestions right now. Try again later.',
  busy: 'AI is busy, try again later.',
  limitReached: (limit: number) => `You’ve used all ${limit} AI suggestions for today. Try again tomorrow.`,
};

/** One line describing an item for an AI prompt, e.g. "F1: Chicken (500 g), expected expiry today". */
export function promptLine(code: string, name: string, quantity: number, unit: string, remainingDays: number): string {
  return `${code}: ${pushCopy.digestLine(`${name} (${quantity} ${unit})`, remainingDays)}`;
}

/**
 * Instructions sent to the AI model. They live here with the other expiry
 * wording. They must never contain a banned phrase or comment on food condition.
 */
export const aiPrompts = {
  system: [
    'You help a home cook plan meals that use up perishable food before its expected expiry.',
    'Every date is a planning estimate, never a promise about the food.',
    'Rules for everything you write:',
    '- Never say or suggest that any food is fit, okay or fine to eat, and never comment on the condition of food.',
    '- Refer to dates only as "expected expiry".',
    '- Never suggest eating something because of its date; the cook always checks their food first.',
    '- The lists you receive are already in priority order, most urgent first. Keep to that order and never re-rank items.',
    '- Refer to food only by the codes given (like F1).',
    '- Plain, friendly British English. Short sentences.',
    'Reply only with JSON that matches the schema.',
  ].join('\n'),

  /** Receipt scanning. It reads text off a photo and says nothing about food. */
  receiptSystem: [
    'You read grocery receipts for a home cook who wants to log what they bought.',
    'Rules for everything you write:',
    '- Report only what is printed. Never guess at an unreadable line: leave it out.',
    '- Never say anything about the condition or freshness of food.',
    '- Plain, short names. British English.',
    'Reply only with JSON that matches the schema.',
  ].join('\n'),

  receipt: (knownNames: string[], today: string) =>
    [
      `Today is ${today}. This is a photo of a grocery receipt.`,
      'List only the food and drink lines that would be kept in a fridge, freezer or cupboard.',
      'Leave out anything else: cleaning, toiletries, bags, totals, tax, discounts, loyalty and payment lines.',
      'For each item give:',
      '- name: a short generic name without brand or size, like "Milk" or "Chicken". Use one of these exact names when it fits: ' +
        knownNames.join(', ') +
        '.',
      '- quantity: how many, as a number. Use 1 if it is not printed. Use a weight or volume only when it is printed on that line.',
      '- unit: one of pcs, g, kg, ml, l, pack, bunch. Use pcs for single things and pack for packets.',
      "- price: that line's price as a number, or null if it is not printed.",
      'Also give purchaseDate as YYYY-MM-DD if the shopping date is clearly printed, otherwise null.',
    ].join('\n'),

  /** Photo Check. It may only report visible problems, never anything good. */
  photoSystem: [
    'You look at a photo of food for a home cook and report only what you can see.',
    'Rules for everything you write:',
    '- Name the product, and say how sure you are of the name.',
    '- List visible warning signs only, each with one allowed type and a short, plain description of what is visible, like "white fuzzy patches on the surface".',
    '- If you see no warning signs, return an empty list. Never write anything about the food looking good, fresh, normal or fine.',
    '- Never say whether any food is fit, okay or fine to eat, keep or throw away.',
    '- Plain, short British English.',
    'Reply only with JSON that matches the schema.',
  ].join('\n'),

  photo: (knownNames: string[]) =>
    [
      'This is a photo of one food item or its packaging.',
      'Give:',
      '- name: a short generic name without brand or size, like "Milk" or "Chicken". Use one of these exact names when it fits: ' +
        knownNames.join(', ') +
        '.',
      '- category: one or two words, like "dairy" or "vegetables".',
      '- confidence: a number from 0 to 1 for how sure you are of the name.',
      '- warningSigns: a list of visible problems only. Each has a type (MOULD, DISCOLOURATION, WILTING, SLIME, BRUISING, DAMAGED_PACKAGING, SWOLLEN_PACKAGING or OTHER) and a short description of what you can see.',
      'A photo cannot show everything. Report only what is visible, and leave the list empty if you see nothing.',
    ].join('\n'),

  recipes: (cookFirst: string[], others: string[], mealType?: string, avoid: string[] = []) =>
    [
      'My Cook First list, most urgent first:',
      ...cookFirst,
      ...(others.length ? ['', 'Other food I have:', ...others] : []),
      '',
      'Suggest up to 3 simple home recipes.',
      ...(mealType ? [`They are for ${mealType}, so suggest dishes that suit ${mealType}.`] : []),
      ...(avoid.length
        ? [`Do not suggest these, which are already chosen for other meals today: ${avoid.join('; ')}.`]
        : []),
      'Each recipe must use at least one item from the Cook First list, and the most urgent items should be used first.',
      'Only use items from these lists plus basic cupboard staples (oil, salt, pepper, spices, water).',
      'For each: a short title, total minutes as a whole number, the codes of the items it uses, and 3 to 6 short steps.',
    ].join('\n'),

  mealPlan: (dates: string[], items: string[]) =>
    [
      'Food I have, most urgent first:',
      ...items,
      '',
      `Plan one simple dinner for each of these dates: ${dates.join(', ')}.`,
      'Use the most urgent items on the earliest dates. A dinner may use no listed items.',
      'For each date: the date exactly as given, a short meal title, and the codes of the items it uses.',
    ].join('\n'),

  fixFormat: 'Your previous answer did not match the required format. Follow the schema exactly.',
  fixWording:
    'Your previous answer used wording that is not allowed. Do not describe any food as fit, okay or fine to eat, do not promise how long food lasts, and refer to dates only as "expected expiry".',
};

/** "a", "a and b", "a, b and c". */
function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Meal-time cooking reminders. The lines naming items reuse pushCopy.digestLine, so they carry the expected-expiry wording. */
export const mealCopy = {
  title: { breakfast: 'Time to cook breakfast', lunch: 'Time to cook lunch', dinner: 'Time to cook dinner' },
  plan: (title: string, foods: string[]) =>
    foods.length ? `Planned: ${title}. It uses ${list(foods)}.` : `Planned: ${title}.`,
  recipe: (title: string, minutes: number, uses: string[]) => `Try ${title} (${minutes} min). It uses ${list(uses)}.`,
  itemsIntro: 'Use these up first:',
  actions: { COOKED: 'Cooked it', RECIPE: 'Show recipe', SNOOZE_MEAL: 'Snooze 30 min' },
};
