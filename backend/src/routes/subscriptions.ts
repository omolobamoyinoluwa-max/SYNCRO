import { Router, Response } from 'express';
import { subscriptionService } from '../services/subscription-service';
import { idempotencyService } from '../services/idempotency';
import { authenticate, AuthenticatedRequest, requireScope } from '../middleware/auth';
import { validateSubscriptionOwnership, validateBulkSubscriptionOwnership } from '../middleware/ownership';
import { validate } from '../middleware/validate';
import { requireRole } from '../middleware/rbac';
import { notificationPreferenceService } from '../services/notification-preference-service';
import { auditService } from '../services/audit-service';
import { previewImport, commitImport, CSV_TEMPLATE } from '../services/csv-import-service';
import logger from '../config/logger';
import multer from 'multer';
import type { Subscription } from '../types/subscription';
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
  listSubscriptionsQuerySchema,
  bulkOperationSchema,
  pauseSubscriptionSchema,
  snoozeSchema,
  notificationPreferencesSchema,
  attachGiftCardSchema,
  trialCancelSchema,
} from '../schemas/subscription';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

const resolveParam = (p: string | string[]): string =>
  Array.isArray(p) ? p[0] : p;

const router: Router = Router();

// All routes require authentication
router.use(authenticate);

// ── GET / — List subscriptions ──────────────────────────────────────────────

/**
 * @openapi
 * /api/subscriptions:
 *   get:
 *     tags: [Subscriptions]
 *     summary: List subscriptions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, cancelled, expired, paused, trial] }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of subscriptions
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/',
  requireScope('subscriptions:read'),
  validate(listSubscriptionsQuerySchema, 'query'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { status, category, limit, offset, cursor } = req.query as any;

      const result = await subscriptionService.listSubscriptions(req.user!.id, {
        status,
        category,
        limit,
        offset,
        cursor,
      });

      res.json({
        success: true,
        data: result.subscriptions,
        pagination: {
          total: result.total,
          limit: Math.min(limit ?? 20, 100),
          hasMore: result.hasMore,
          nextCursor: result.nextCursor ?? null,
        },
      });
    } catch (error) {
      logger.error('List subscriptions error:', error);

      if (error instanceof Error && error.message.includes('cursor')) {
        return res.status(400).json({ success: false, error: error.message });
      }

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list subscriptions',
      });
    }
  },
);

// ── GET /:id — Get single subscription ──────────────────────────────────────

router.get(
  '/:id',
  requireScope('subscriptions:read'),
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const subscription = await subscriptionService.getSubscription(
        req.user!.id,
        resolveParam(req.params.id),
      );
      res.json({ success: true, data: subscription });
    } catch (error) {
      logger.error('Get subscription error:', error);
      const statusCode =
        error instanceof Error && error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get subscription',
      });
    }
  },
);

// ── GET /:id/price-history ──────────────────────────────────────────────────

router.get(
  '/:id/price-history',
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const history = await subscriptionService.getPriceHistory(
        req.user!.id,
        resolveParam(req.params.id),
      );
      res.json({ success: true, data: history });
    } catch (error) {
      logger.error('Get price history error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get price history',
      });
    }
  },
);

// ── POST / — Create subscription ────────────────────────────────────────────

/**
 * @openapi
 * /api/subscriptions:
 *   post:
 *     tags: [Subscriptions]
 *     summary: Create a subscription
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Subscription created
 *       422:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/',
  requireScope('subscriptions:write'),
  validate(createSubscriptionSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string;
      const requestHash = idempotencyService.hashRequest(req.body);

      if (idempotencyKey) {
        const idempotencyCheck = await idempotencyService.checkIdempotency(
          idempotencyKey,
          req.user!.id,
          requestHash,
        );
        if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
          logger.info('Returning cached response for idempotent request', {
            idempotencyKey, userId: req.user!.id,
          });
          return res
            .status(idempotencyCheck.cachedResponse.status)
            .json(idempotencyCheck.cachedResponse.body);
        }
      }

      const result = await subscriptionService.createSubscription(
        req.user!.id,
        req.body,
        idempotencyKey || undefined,
      );

      const responseBody = {
        success: true,
        data: result.subscription,
        blockchain: {
          synced: result.syncStatus === 'synced',
          transactionHash: result.blockchainResult?.transactionHash,
          error: result.blockchainResult?.error,
        },
      };

      const statusCode = result.syncStatus === 'failed' ? 207 : 201;

      if (idempotencyKey) {
        await idempotencyService.storeResponse(
          idempotencyKey, req.user!.id, requestHash, statusCode, responseBody,
        );
      }

      res.status(statusCode).json(responseBody);
    } catch (error) {
      logger.error('Create subscription error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create subscription',
      });
    }
  },
);

// ── PATCH /:id — Update subscription ────────────────────────────────────────

router.patch(
  '/:id',
  requireScope('subscriptions:write'),
  validateSubscriptionOwnership,
  validate(updateSubscriptionSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string;
      const requestHash = idempotencyService.hashRequest(req.body);

      if (idempotencyKey) {
        const idempotencyCheck = await idempotencyService.checkIdempotency(
          idempotencyKey, req.user!.id, requestHash,
        );
        if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
          return res
            .status(idempotencyCheck.cachedResponse.status)
            .json(idempotencyCheck.cachedResponse.body);
        }
      }

      const expectedVersion = req.headers['if-match'] as string;

      const result = await subscriptionService.updateSubscription(
        req.user!.id,
        resolveParam(req.params.id),
        req.body,
        expectedVersion ? parseInt(expectedVersion) : undefined,
      );

      const responseBody = {
        success: true,
        data: result.subscription,
        blockchain: {
          synced: result.syncStatus === 'synced',
          transactionHash: result.blockchainResult?.transactionHash,
          error: result.blockchainResult?.error,
        },
      };

      const statusCode = result.syncStatus === 'failed' ? 207 : 200;

      if (idempotencyKey) {
        await idempotencyService.storeResponse(
          idempotencyKey, req.user!.id, requestHash, statusCode, responseBody,
        );
      }

      res.status(statusCode).json(responseBody);
    } catch (error) {
      logger.error('Update subscription error:', error);
      const statusCode =
        error instanceof Error && error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update subscription',
      });
    }
  },
);

// ── DELETE /:id — Delete subscription ───────────────────────────────────────

router.delete(
  '/:id',
  requireScope('subscriptions:write'),
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await subscriptionService.deleteSubscription(
        req.user!.id,
        resolveParam(req.params.id),
      );

      const responseBody = {
        success: true,
        message: 'Subscription deleted',
        blockchain: {
          synced: result.syncStatus === 'synced',
          transactionHash: result.blockchainResult?.transactionHash,
          error: result.blockchainResult?.error,
        },
      };

      const statusCode = result.syncStatus === 'failed' ? 207 : 200;
      res.status(statusCode).json(responseBody);
    } catch (error) {
      logger.error('Delete subscription error:', error);
      const statusCode =
        error instanceof Error && error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete subscription',
      });
    }
  },
);

// ── POST /:id/cancel — Cancel subscription ──────────────────────────────────

router.post(
  '/:id/cancel',
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string;
      const requestHash = idempotencyService.hashRequest(req.body);

      if (idempotencyKey) {
        const idempotencyCheck = await idempotencyService.checkIdempotency(
          idempotencyKey, req.user!.id, requestHash,
        );
        if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
          return res
            .status(idempotencyCheck.cachedResponse.status)
            .json(idempotencyCheck.cachedResponse.body);
        }
      }

      const result = await subscriptionService.cancelSubscription(
        req.user!.id,
        resolveParam(req.params.id),
      );

      const responseBody = {
        success: true,
        data: result.subscription,
        blockchain: {
          synced: result.syncStatus === 'synced',
          transactionHash: result.blockchainResult?.transactionHash,
          error: result.blockchainResult?.error,
        },
      };

      const statusCode = result.syncStatus === 'failed' ? 207 : 200;

      if (idempotencyKey) {
        await idempotencyService.storeResponse(
          idempotencyKey, req.user!.id, requestHash, statusCode, responseBody,
        );
      }

      res.status(statusCode).json(responseBody);
    } catch (error) {
      logger.error('Cancel subscription error:', error);
      const statusCode =
        error instanceof Error && error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel subscription',
      });
    }
  },
);

// ── POST /:id/pause — Pause subscription ────────────────────────────────────

router.post(
  '/:id/pause',
  validateSubscriptionOwnership,
  validate(pauseSubscriptionSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string;
      const requestHash = idempotencyService.hashRequest(req.body);

      if (idempotencyKey) {
        const idempotencyCheck = await idempotencyService.checkIdempotency(
          idempotencyKey, req.user!.id, requestHash,
        );
        if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
          return res
            .status(idempotencyCheck.cachedResponse.status)
            .json(idempotencyCheck.cachedResponse.body);
        }
      }

      const { resumeAt, reason } = req.body;

      if (resumeAt && new Date(resumeAt) <= new Date()) {
        return res.status(400).json({
          success: false,
          error: 'resumeAt must be a future date',
        });
      }

      const result = await subscriptionService.pauseSubscription(
        req.user!.id,
        resolveParam(req.params.id),
        resumeAt,
        reason,
      );

      const responseBody = {
        success: true,
        data: result.subscription,
        blockchain: {
          synced: result.syncStatus === 'synced',
          transactionHash: result.blockchainResult?.transactionHash,
          error: result.blockchainResult?.error,
        },
      };

      const statusCode = result.syncStatus === 'failed' ? 207 : 200;

      if (idempotencyKey) {
        await idempotencyService.storeResponse(
          idempotencyKey, req.user!.id, requestHash, statusCode, responseBody,
        );
      }

      res.status(statusCode).json(responseBody);
    } catch (error) {
      logger.error('Pause subscription error:', error);
      const statusCode =
        error instanceof Error && error.message.includes('not found') ? 404
        : error instanceof Error && error.message.includes('already paused') ? 409
        : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pause subscription',
      });
    }
  },
);

// ── POST /:id/resume — Resume subscription ──────────────────────────────────

router.post(
  '/:id/resume',
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const idempotencyKey = req.headers['idempotency-key'] as string;
      const requestHash = idempotencyService.hashRequest(req.body);

      if (idempotencyKey) {
        const idempotencyCheck = await idempotencyService.checkIdempotency(
          idempotencyKey, req.user!.id, requestHash,
        );
        if (idempotencyCheck.isDuplicate && idempotencyCheck.cachedResponse) {
          return res
            .status(idempotencyCheck.cachedResponse.status)
            .json(idempotencyCheck.cachedResponse.body);
        }
      }

      const result = await subscriptionService.resumeSubscription(
        req.user!.id,
        resolveParam(req.params.id),
      );

      const responseBody = {
        success: true,
        data: result.subscription,
        blockchain: {
          synced: result.syncStatus === 'synced',
          transactionHash: result.blockchainResult?.transactionHash,
          error: result.blockchainResult?.error,
        },
      };

      const statusCode = result.syncStatus === 'failed' ? 207 : 200;

      if (idempotencyKey) {
        await idempotencyService.storeResponse(
          idempotencyKey, req.user!.id, requestHash, statusCode, responseBody,
        );
      }

      res.status(statusCode).json(responseBody);
    } catch (error) {
      logger.error('Resume subscription error:', error);
      const statusCode =
        error instanceof Error && error.message.includes('not found') ? 404
        : error instanceof Error && error.message.includes('not paused') ? 409
        : 500;
      res.status(statusCode).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resume subscription',
      });
    }
  },
);

// ── POST /:id/attach-gift-card ──────────────────────────────────────────────

router.post(
  '/:id/attach-gift-card',
  validateSubscriptionOwnership,
  validate(attachGiftCardSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const subscriptionId = resolveParam(req.params.id);
      const { giftCardHash, provider } = req.body;

      const result = await giftCardService.attachGiftCard(
        req.user!.id,
        subscriptionId,
        giftCardHash,
        provider,
      );

      if (!result.success) {
        const statusCode =
          result.error?.includes('not found') || result.error?.includes('access denied') ? 404 : 400;
        return res.status(statusCode).json({ success: false, error: result.error });
      }

      res.status(201).json({
        success: true,
        data: result.data,
        blockchain: {
          transactionHash: result.blockchainResult?.transactionHash,
          error: result.blockchainResult?.error,
        },
      });
    } catch (error) {
      logger.error('Attach gift card error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to attach gift card',
      });
    }
  },
);

// ── POST /:id/retry-sync ────────────────────────────────────────────────────

router.post(
  '/:id/retry-sync',
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await subscriptionService.retryBlockchainSync(
        req.user!.id,
        resolveParam(req.params.id),
      );

      res.json({
        success: result.success,
        transactionHash: result.transactionHash,
        error: result.error,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to retry sync';

      if (errorMessage.includes('Cooldown period active')) {
        logger.warn('Retry sync rejected due to cooldown:', errorMessage);
        return res.status(429).json({
          success: false,
          error: errorMessage,
          retryAfter: extractWaitTime(errorMessage),
        });
      }

      logger.error('Retry sync error:', error);
      res.status(500).json({ success: false, error: errorMessage });
    }
  },
);

// ── GET /:id/cooldown-status ────────────────────────────────────────────────

router.get(
  '/:id/cooldown-status',
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const cooldownStatus = await subscriptionService.checkRenewalCooldown(
        resolveParam(req.params.id),
      );

      res.json({
        success: true,
        canRetry: cooldownStatus.canRetry,
        isOnCooldown: cooldownStatus.isOnCooldown,
        timeRemainingSeconds: cooldownStatus.timeRemainingSeconds,
        message: cooldownStatus.message,
      });
    } catch (error) {
      logger.error('Cooldown status check error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check cooldown status',
      });
    }
  },
);

// ── POST /bulk — Bulk operations ────────────────────────────────────────────

router.post(
  '/bulk',
  validateBulkSubscriptionOwnership,
  validate(bulkOperationSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { operation, ids, data } = req.body;

      const results: any[] = [];
      const errors: any[] = [];

      for (const id of ids) {
        try {
          let result;
          switch (operation) {
            case 'delete':
              result = await subscriptionService.deleteSubscription(req.user!.id, id);
              break;
            case 'update':
              if (!data) throw new Error('Update data required');
              result = await subscriptionService.updateSubscription(req.user!.id, id, data);
              break;
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
          results.push({ id, success: true, result });
        } catch (error) {
          errors.push({ id, error: error instanceof Error ? error.message : String(error) });
        }
      }

      res.json({
        success: errors.length === 0,
        results,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      logger.error('Bulk operation error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to perform bulk operation',
      });
    }
  },
);

// ── PATCH /:id/notification-preferences ─────────────────────────────────────

router.patch(
  '/:id/notification-preferences',
  validateSubscriptionOwnership,
  validate(notificationPreferencesSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const subscriptionId = resolveParam(req.params.id);

      const preferences = await notificationPreferenceService.upsertPreferences(
        subscriptionId,
        req.body,
      );

      res.json({ success: true, data: preferences });
    } catch (error) {
      logger.error('Update notification preferences error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update notification preferences',
      });
    }
  },
);

// ── POST /:id/snooze ────────────────────────────────────────────────────────

router.post(
  '/:id/snooze',
  validateSubscriptionOwnership,
  validate(snoozeSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const subscriptionId = resolveParam(req.params.id);

      const preferences = await notificationPreferenceService.snooze(
        subscriptionId,
        req.body.until,
      );

      res.json({
        success: true,
        data: preferences,
        message: `Reminders snoozed until ${req.body.until}`,
      });
    } catch (error) {
      logger.error('Snooze subscription error:', error);

      const isValidationError =
        error instanceof Error &&
        (error.message.includes('Invalid snooze date') ||
          error.message.includes('must be in the future'));

      res.status(isValidationError ? 400 : 500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to snooze subscription',
      });
    }
  },
);

// ── POST /:id/trial/convert ─────────────────────────────────────────────────

router.post(
  '/:id/trial/convert',
  validateSubscriptionOwnership,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const subId = resolveParam(req.params.id);
      const { supabase } = await import('../config/database');

      const { data: sub, error: fetchErr } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('id', subId)
        .eq('user_id', req.user!.id)
        .single();

      if (fetchErr || !sub) {
        return res.status(404).json({ success: false, error: 'Subscription not found' });
      }

      if (!sub.is_trial) {
        return res.status(400).json({ success: false, error: 'Subscription is not a trial' });
      }

      await supabase.from('subscriptions').update({
        is_trial: false,
        status: 'active',
        price: sub.trial_converts_to_price ?? sub.price_after_trial ?? sub.price,
        updated_at: new Date().toISOString(),
      }).eq('id', subId);

      await supabase.from('trial_conversion_events').insert({
        subscription_id: subId,
        user_id: req.user!.id,
        outcome: 'converted',
        conversion_type: 'intentional',
        saved_by_syncro: false,
        converted_price: sub.trial_converts_to_price ?? sub.price_after_trial ?? sub.price,
      });

      res.json({ success: true, message: 'Trial converted to paid subscription' });
    } catch (error) {
      logger.error('Trial convert error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert trial',
      });
    }
  },
);

// ── POST /:id/trial/cancel ──────────────────────────────────────────────────

router.post(
  '/:id/trial/cancel',
  validateSubscriptionOwnership,
  validate(trialCancelSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const subId = resolveParam(req.params.id);
      const { acted_on_reminder_days } = req.body;
      const { supabase } = await import('../config/database');

      const { data: sub, error: fetchErr } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('id', subId)
        .eq('user_id', req.user!.id)
        .single();

      if (fetchErr || !sub) {
        return res.status(404).json({ success: false, error: 'Subscription not found' });
      }

      if (!sub.is_trial) {
        return res.status(400).json({ success: false, error: 'Subscription is not a trial' });
      }

      await supabase.from('subscriptions').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', subId);

      await supabase.from('trial_conversion_events').insert({
        subscription_id: subId,
        user_id: req.user!.id,
        outcome: 'cancelled',
        conversion_type: 'intentional',
        saved_by_syncro: sub.credit_card_required === true,
        acted_on_reminder_days: acted_on_reminder_days ?? null,
      });

      res.json({ success: true, message: 'Trial cancelled successfully' });
    } catch (error) {
      logger.error('Trial cancel error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel trial',
      });
    }
  },
);

// ── GET /trials/saved-metric ────────────────────────────────────────────────

router.get(
  '/trials/saved-metric',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { supabase } = await import('../config/database');

      const { count, error } = await supabase
        .from('trial_conversion_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user!.id)
        .eq('saved_by_syncro', true);

      if (error) throw error;

      res.json({ success: true, savedCount: count ?? 0 });
    } catch (error) {
      logger.error('Saved metric error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch saved metric' });
    }
  },
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractWaitTime(message: string): number {
  const match = message.match(/wait (\d+) seconds/);
  return match ? parseInt(match[1], 10) : 60;
}

export default router;
