import {
  bulkCreateSchema,
  createFoodSchema,
  deliverySchema,
  favouriteSchema,
  loginSchema,
  mealPlanEntrySchema,
  moveFoodSchema,
  openFoodSchema,
  notificationPageSchema,
  paginationSchema,
  preferencesSchema,
  pushActionSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  registerSchema,
  shoppingItemSchema,
  shoppingUpdateSchema,
  updateAccountSchema,
  updateFoodSchema,
  useFoodSchema,
  wasteFoodSchema,
} from '@cook-first/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { aiController } from '../controllers/aiController.js';
import { authController } from '../controllers/authController.js';
import { favouriteController } from '../controllers/favouriteController.js';
import { foodController } from '../controllers/foodController.js';
import { mealPlanController } from '../controllers/mealPlanController.js';
import { suggestionController } from '../controllers/suggestionController.js';
import { notificationController } from '../controllers/notificationController.js';
import { pushController } from '../controllers/pushController.js';
import { shoppingController } from '../controllers/shoppingController.js';
import { usageController } from '../controllers/usageController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const router = Router();

/** Authentication routes: 20 requests per 15 minutes per IP address. */
export const AUTH_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 20 };

const authLimiter = rateLimit({
  ...AUTH_RATE_LIMIT,
  // Tests turn it off, except the test that checks the limit itself.
  skip: () => process.env.AUTH_RATE_LIMIT === 'off',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

// Requests flow: route → middleware (rate limit, auth, validation) → controller → service.

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.post('/auth/register', authLimiter, validate(registerSchema), authController.register);
router.post('/auth/login', authLimiter, validate(loginSchema), authController.login);

/** Notification buttons: 60 requests per 15 minutes per IP address. */
export const PUSH_ACTION_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 60 };

const pushActionLimiter = rateLimit({
  ...PUSH_ACTION_RATE_LIMIT,
  skip: () => process.env.AUTH_RATE_LIMIT === 'off',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

// "Used" and "Snooze" inside a push notification. The service worker has no
// login token; the body carries a single-item action token instead.
router.post('/push/actions', pushActionLimiter, validate(pushActionSchema), pushController.action);

// Everything below requires a valid bearer token.
router.use(requireAuth);

router.get('/auth/me', authController.me);
router.put('/auth/me', validate(updateAccountSchema), authController.updateMe);

router.get('/foods', foodController.list);
router.post('/foods', validate(createFoodSchema), foodController.create);
router.post('/foods/bulk', validate(bulkCreateSchema), foodController.bulkCreate);
// /foods/cook-first must be registered before /foods/:id, or "cook-first" would be taken as an id.
router.get('/foods/cook-first', foodController.cookFirst);
router.get('/foods/:id', foodController.get);
router.put('/foods/:id', validate(updateFoodSchema), foodController.update);
router.delete('/foods/:id', foodController.remove);
router.post('/foods/:id/use', validate(useFoodSchema), foodController.use);
router.post('/foods/:id/waste', validate(wasteFoodSchema), foodController.waste);
router.post('/foods/:id/undo', foodController.undo);
router.post('/foods/:id/open', validate(openFoodSchema), foodController.open);
router.delete('/foods/:id/open', foodController.undoOpen);
router.post('/foods/:id/move', validate(moveFoodSchema), foodController.move);

router.get('/suggestions/lifespans', suggestionController.lifespans);

router.get('/favourites', favouriteController.list);
router.post('/favourites', validate(favouriteSchema), favouriteController.create);
router.delete('/favourites/:id', favouriteController.remove);
router.post('/favourites/:id/add', favouriteController.add);

router.get('/usage', validate(paginationSchema, 'query'), usageController.list);

router.get('/notifications', validate(notificationPageSchema, 'query'), notificationController.list);
router.get('/notifications/unread-count', notificationController.unreadCount);
router.get('/notifications/preferences', notificationController.getPreferences);
router.put('/notifications/preferences', validate(preferencesSchema), notificationController.updatePreferences);
router.post('/notifications/read-all', notificationController.markAllRead);
router.get('/notifications/delivery', notificationController.getDelivery);
router.put('/notifications/delivery', validate(deliverySchema), notificationController.updateDelivery);

router.get('/push/config', pushController.config);
router.post('/push/subscriptions', validate(pushSubscriptionSchema), pushController.subscribe);
router.delete('/push/subscriptions', validate(pushUnsubscribeSchema), pushController.unsubscribe);

// Phase 4: using the food. AI routes read the Cook First order and never change it.
router.get('/ai/status', aiController.status);
router.post('/ai/recipes', aiController.recipes);
router.post('/ai/meal-plan', aiController.mealPlan);

router.get('/shopping', shoppingController.list);
router.post('/shopping', validate(shoppingItemSchema), shoppingController.add);
router.post('/shopping/clear-checked', shoppingController.clearChecked);
router.put('/shopping/:id', validate(shoppingUpdateSchema), shoppingController.update);
router.delete('/shopping/:id', shoppingController.remove);

router.get('/meal-plan', mealPlanController.get);
router.put('/meal-plan/:date', validate(mealPlanEntrySchema), mealPlanController.set);
router.delete('/meal-plan/:date', mealPlanController.clear);
