import {
  createFoodSchema,
  loginSchema,
  notificationPageSchema,
  paginationSchema,
  preferencesSchema,
  registerSchema,
  updateAccountSchema,
  updateFoodSchema,
  useFoodSchema,
  wasteFoodSchema,
} from '@cook-first/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/authController.js';
import { foodController } from '../controllers/foodController.js';
import { notificationController } from '../controllers/notificationController.js';
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

// Everything below requires a valid bearer token.
router.use(requireAuth);

router.get('/auth/me', authController.me);
router.put('/auth/me', validate(updateAccountSchema), authController.updateMe);

router.get('/foods', foodController.list);
router.post('/foods', validate(createFoodSchema), foodController.create);
// /foods/cook-first must be registered before /foods/:id, or "cook-first" would be taken as an id.
router.get('/foods/cook-first', foodController.cookFirst);
router.get('/foods/:id', foodController.get);
router.put('/foods/:id', validate(updateFoodSchema), foodController.update);
router.delete('/foods/:id', foodController.remove);
router.post('/foods/:id/use', validate(useFoodSchema), foodController.use);
router.post('/foods/:id/waste', validate(wasteFoodSchema), foodController.waste);

router.get('/usage', validate(paginationSchema, 'query'), usageController.list);

router.get('/notifications', validate(notificationPageSchema, 'query'), notificationController.list);
router.get('/notifications/unread-count', notificationController.unreadCount);
router.get('/notifications/preferences', notificationController.getPreferences);
router.put('/notifications/preferences', validate(preferencesSchema), notificationController.updatePreferences);
router.post('/notifications/read-all', notificationController.markAllRead);
