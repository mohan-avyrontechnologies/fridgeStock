import {
  addDays,
  type DateString,
  type Insights,
  type InsightsPeriod,
  type InsightsTip,
  type InsightsWastedFood,
  type InsightsWeek,
} from '@fridgestock/shared';
import { FoodItemModel } from '../models/FoodItem.js';
import { UsageRecordModel, type UsageRecord } from '../models/UsageRecord.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';

const WEEK_DAYS = 7;
const WEEKS_SHOWN = 8;
const MONTH_DAYS = 30;
const TOP_WASTED = 5;
/** A food has to be wasted this many times in the month before a tip names it. */
const REPEAT_WASTE = 2;

type Entry = Pick<UsageRecord, 'action' | 'date' | 'foodName' | 'value'>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Used (fully or partly) and wasted entries only: removals are mistakes or cleanups, not food outcomes. */
const isOutcome = (e: Entry) => e.action !== 'REMOVED';
const isWaste = (e: Entry) => e.action === 'WASTED';

function summarise(entries: Entry[]): InsightsPeriod {
  const outcomes = entries.filter(isOutcome);
  const wasted = outcomes.filter(isWaste);
  const used = outcomes.filter((e) => !isWaste(e));
  const sum = (list: Entry[]) => round2(list.reduce((total, e) => total + (e.value ?? 0), 0));
  return {
    used: used.length,
    wasted: wasted.length,
    wasteRate: outcomes.length === 0 ? null : wasted.length / outcomes.length,
    savedValue: sum(used),
    lostValue: sum(wasted),
    pricedEntries: outcomes.filter((e) => e.value != null).length,
  };
}

/** Entries whose day is from..to, both included (dates are "YYYY-MM-DD", so strings compare in order). */
const between = (entries: Entry[], from: DateString, to: DateString) =>
  entries.filter((e) => e.date >= from && e.date <= to);

function topWasted(entries: Entry[]): InsightsWastedFood[] {
  const byName = new Map<string, InsightsWastedFood>();
  for (const e of entries.filter(isWaste)) {
    const key = e.foodName.trim().toLowerCase();
    const row = byName.get(key) ?? { name: e.foodName.trim(), count: 0, lostValue: 0 };
    row.count += 1;
    row.lostValue = round2(row.lostValue + (e.value ?? 0));
    byName.set(key, row);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || b.lostValue - a.lostValue).slice(0, TOP_WASTED);
}

/**
 * Plain-language tips from the numbers. They talk about habits and amounts
 * bought, never about whether any food can be eaten, and they never suggest a
 * different FridgeStock order.
 */
function tipsFor(
  thisWeek: InsightsPeriod,
  lastWeek: InsightsPeriod,
  month: InsightsPeriod,
  wasted: InsightsWastedFood[],
  overdueNow: number,
): InsightsTip[] {
  const tips: InsightsTip[] = [];
  const worst = wasted[0];
  if (worst && worst.count >= REPEAT_WASTE) {
    tips.push({
      id: 'repeat-waste',
      text: `You have wasted ${worst.name} ${worst.count} times in the last ${MONTH_DAYS} days. Try buying less of it, or freezing part of it when you buy it.`,
    });
  }
  if (thisWeek.wasted > lastWeek.wasted) {
    tips.push({
      id: 'waste-up',
      text: `You wasted ${thisWeek.wasted} ${thisWeek.wasted === 1 ? 'item' : 'items'} this week, up from ${lastWeek.wasted} the week before. Look at FridgeStock each morning to plan what to use.`,
    });
  }
  if (thisWeek.wasted === 0 && thisWeek.used >= REPEAT_WASTE) {
    tips.push({ id: 'no-waste', text: 'Nothing was wasted this week. Keep checking FridgeStock each day.' });
  }
  if (overdueNow > 0) {
    tips.push({
      id: 'overdue-now',
      text: `${overdueNow} ${overdueNow === 1 ? 'item is' : 'items are'} overdue on FridgeStock. Check ${overdueNow === 1 ? 'it' : 'them'} yourself, then mark what you used or wasted.`,
    });
  }
  if (month.used + month.wasted > 0 && month.pricedEntries === 0) {
    tips.push({
      id: 'add-prices',
      text: 'Add a price when you add food to see how much you save and lose each week.',
    });
  }
  return tips;
}

/** Used-versus-wasted figures, eight weeks of history, the most wasted foods and tips, all for the signed-in user. */
export async function getInsights(user: UserDoc): Promise<Insights> {
  const today = clock.today(user.timeZone);
  const firstDay = addDays(today, -(WEEK_DAYS * WEEKS_SHOWN - 1));
  const [entries, overdueNow] = await Promise.all([
    UsageRecordModel.find({ householdId: user.householdId, date: { $gte: firstDay, $lte: today } }).lean<Entry[]>(),
    FoodItemModel.countDocuments({ householdId: user.householdId, status: 'ACTIVE', expiryDate: { $lt: today } }),
  ]);

  const weeks: InsightsWeek[] = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
    const to = addDays(today, -i * WEEK_DAYS);
    const from = addDays(to, -(WEEK_DAYS - 1));
    weeks.push({ from, to, ...summarise(between(entries, from, to)) });
  }
  const month = between(entries, addDays(today, -(MONTH_DAYS - 1)), today);
  const thisWeek = summarise(between(entries, addDays(today, -(WEEK_DAYS - 1)), today));
  const lastWeek = summarise(between(entries, addDays(today, -(2 * WEEK_DAYS - 1)), addDays(today, -WEEK_DAYS)));
  const last30Days = summarise(month);
  const wasted = topWasted(month);

  return {
    today,
    thisWeek,
    lastWeek,
    last30Days,
    weeks,
    topWasted: wasted,
    tips: tipsFor(thisWeek, lastWeek, last30Days, wasted, overdueNow),
  };
}
