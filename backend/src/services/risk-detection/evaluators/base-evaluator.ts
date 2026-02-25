/**
 * Base Risk Factor Evaluator Interface
 */

import { Subscription } from '../../../types/subscription';
import { RiskWeight, RiskContext, RiskWeightConfig } from '../../../types/risk-detection';

/**
 * Interface for risk factor evaluators
 */
export interface RiskFactorEvaluator {
  /**
   * Evaluate risk for a subscription
   * @param subscription The subscription to evaluate
   * @param context Additional context for evaluation
   * @returns Risk weight with details
   */
  evaluate(subscription: Subscription, context: RiskContext): Promise<RiskWeight>;
}

/**
 * Helper function to convert weight value to numeric
 */
export function weightToNumeric(weight: 'NONE' | 'MEDIUM' | 'HIGH', config: RiskWeightConfig, factorType: string): number {
  switch (factorType) {
    case 'consecutive_failures':
      if (weight === 'NONE') return config.consecutiveFailures.none;
      if (weight === 'MEDIUM') return config.consecutiveFailures.medium;
      return config.consecutiveFailures.high;
    
    case 'balance_projection':
      if (weight === 'NONE') return config.balanceProjection.sufficient;
      if (weight === 'MEDIUM') return config.balanceProjection.low;
      return config.balanceProjection.insufficient;
    
    case 'approval_expiration':
      if (weight === 'NONE') return config.approvalExpiration.valid;
      return config.approvalExpiration.expired;
    
    default:
      return 0;
  }
}
