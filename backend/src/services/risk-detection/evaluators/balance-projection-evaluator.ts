/**
 * Balance Projection Risk Evaluator
 * Evaluates risk based on projected account balance vs renewal amount
 */

import { Subscription } from '../../../types/subscription';
import { RiskWeight, RiskContext, RiskWeightConfig, RiskWeightValue } from '../../../types/risk-detection';
import { RiskFactorEvaluator, weightToNumeric } from './base-evaluator';
import logger from '../../../config/logger';

export class BalanceProjectionEvaluator implements RiskFactorEvaluator {
  constructor(private config: RiskWeightConfig) {}

  async evaluate(subscription: Subscription, context: RiskContext): Promise<RiskWeight> {
    try {
      // Check if subscription has a next billing date
      if (!subscription.next_billing_date) {
        logger.debug(`Subscription ${subscription.id} has no next_billing_date, skipping balance projection`);
        return {
          type: 'balance_projection',
          weight: 'NONE',
          numericWeight: 0,
          details: {
            reason: 'No next billing date',
          },
        };
      }

      // Check if projected balance is provided in context
      if (context.projectedBalance === undefined || context.projectedBalance === null) {
        logger.debug(`No projected balance provided for subscription ${subscription.id}`);
        return {
          type: 'balance_projection',
          weight: 'NONE',
          numericWeight: 0,
          details: {
            reason: 'No projected balance available',
          },
        };
      }

      const renewalAmount = subscription.price;
      const projectedBalance = context.projectedBalance;
      const balanceRatio = projectedBalance / renewalAmount;

      // Determine weight based on balance ratio
      let weight: RiskWeightValue;
      if (balanceRatio >= 1.2) {
        // Balance is at least 120% of renewal amount
        weight = 'NONE';
      } else if (balanceRatio >= 1.0) {
        // Balance is between 100% and 120% of renewal amount
        weight = 'MEDIUM';
      } else {
        // Balance is below renewal amount
        weight = 'HIGH';
      }

      const numericWeight = weightToNumeric(weight, this.config, 'balance_projection');

      return {
        type: 'balance_projection',
        weight,
        numericWeight,
        details: {
          projected_balance: projectedBalance,
          renewal_amount: renewalAmount,
          balance_ratio: balanceRatio,
          next_billing_date: subscription.next_billing_date,
        },
      };
    } catch (error) {
      logger.error('Error in BalanceProjectionEvaluator:', error);
      // Return NONE weight on error (graceful degradation)
      return {
        type: 'balance_projection',
        weight: 'NONE',
        numericWeight: 0,
        details: {
          error: 'Failed to evaluate balance projection',
        },
      };
    }
  }
}
