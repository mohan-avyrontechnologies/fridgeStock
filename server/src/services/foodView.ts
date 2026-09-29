import type { Urgency } from '../config/urgency.js';
import type { FoodItemDoc } from '../models/FoodItem.js';
import { classifyUrgency } from './priorityEngine.js';
import { diffDays, toDateKey } from '../utils/dates.js';

export interface FoodItemView {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  addedDate: string;
  lifespanDays: number;
  expectedExpiryDate: string;
  status: string;
  /** Only present while the item is active. */
  remainingDays: number | null;
  urgency: Urgency | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPrioritisable(doc: FoodItemDoc) {
  return {
    id: doc._id.toString(),
    status: doc.status,
    addedDate: doc.addedDate,
    expiryDate: doc.expiryDate,
    doc,
  };
}

export function toFoodView(doc: FoodItemDoc, today: Date): FoodItemView {
  const active = doc.status === 'ACTIVE';
  const remainingDays = active ? diffDays(doc.expiryDate, today) : null;
  return {
    id: doc._id.toString(),
    name: doc.name,
    quantity: doc.quantity,
    unit: doc.unit,
    addedDate: toDateKey(doc.addedDate),
    lifespanDays: doc.lifespanDays,
    expectedExpiryDate: toDateKey(doc.expiryDate),
    status: doc.status,
    remainingDays,
    urgency: remainingDays === null ? null : classifyUrgency(remainingDays),
    closedAt: doc.closedAt ? doc.closedAt.toISOString() : null,
    createdAt: (doc.get('createdAt') as Date).toISOString(),
    updatedAt: (doc.get('updatedAt') as Date).toISOString(),
  };
}
