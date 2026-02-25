/**
 * Risk Notification Service
 * Handles notifications for risk level changes
 */

import { supabase } from '../../config/database';
import logger from '../../config/logger';
import { RiskLevel, RiskScore, RiskNotificationPayload } from '../../types/risk-detection';

export class RiskNotificationService {
  /**
   * Check if notification should be sent based on risk level change
   */
  private shouldNotify(previousLevel: RiskLevel | undefined, newLevel: RiskLevel): boolean {
    // Notify when transitioning to HIGH
    if (newLevel === 'HIGH' && previousLevel !== 'HIGH') {
      return true;
    }

    // Notify when transitioning from HIGH to lower
    if (previousLevel === 'HIGH' && newLevel !== 'HIGH') {
      return true;
    }

    return false;
  }

  /**
   * Send risk notification
   */
  private async sendNotification(payload: RiskNotificationPayload): Promise<void> {
    try {
      // For now, we'll log the notification
      // In production, this would integrate with the existing notification system
      logger.info('Risk notification triggered', {
        subscription_id: payload.subscription_id,
        subscription_name: payload.subscription_name,
        previous_risk_level: payload.previous_risk_level,
        new_risk_level: payload.new_risk_level,
        risk_factors: payload.risk_factors.map(f => f.factor_type),
      });

      // TODO: Integrate with actual notification system
      // This could call the reminder engine or a dedicated notification service
      // Example:
      // await notificationService.send({
      //   user_id: payload.user_id,
      //   type: 'risk_alert',
      //   title: `Subscription Risk Alert: ${payload.subscription_name}`,
      //   body: this.buildNotificationMessage(payload),
      //   data: payload,
      // });

    } catch (error) {
      logger.error('Error sending risk notification:', error);
      // Don't throw - notification failures shouldn't block risk calculation
    }
  }

  /**
   * Build notification message based on risk level
   */
  private buildNotificationMessage(payload: RiskNotificationPayload): string {
    if (payload.new_risk_level === 'HIGH') {
      const factors = payload.risk_factors
        .filter(f => f.weight !== 'NONE')
        .map(f => {
          switch (f.factor_type) {
            case 'consecutive_failures':
              return 'consecutive payment failures';
            case 'balance_projection':
              return 'low account balance';
            case 'approval_expiration':
              return 'expired approval';
            default:
              return f.factor_type;
          }
        });

      return `Your subscription "${payload.subscription_name}" is at HIGH risk due to: ${factors.join(', ')}. Please take action to prevent service interruption.`;
    } else {
      return `Your subscription "${payload.subscription_name}" risk level has improved to ${payload.new_risk_level}.`;
    }
  }

  /**
   * Handle risk level change and trigger notifications
   */
  async handleRiskChange(
    newRiskScore: RiskScore,
    subscriptionName: string,
    subscriptionPrice: number
  ): Promise<void> {
    try {
      const previousLevel = newRiskScore.last_notified_risk_level;
      const newLevel = newRiskScore.risk_level;

      // Check if notification should be sent
      if (!this.shouldNotify(previousLevel, newLevel)) {
        logger.debug('No notification needed for risk level change', {
          subscription_id: newRiskScore.subscription_id,
          previous_level: previousLevel,
          new_level: newLevel,
        });
        return;
      }

      // Build notification payload
      const payload: RiskNotificationPayload = {
        subscription_id: newRiskScore.subscription_id,
        subscription_name: subscriptionName,
        subscription_price: subscriptionPrice,
        previous_risk_level: previousLevel,
        new_risk_level: newLevel,
        risk_factors: newRiskScore.risk_factors,
        user_id: newRiskScore.user_id,
      };

      // Send notification
      await this.sendNotification(payload);

      // Update last notified risk level to prevent duplicates
      await this.updateLastNotifiedLevel(newRiskScore.subscription_id, newLevel);

    } catch (error) {
      logger.error('Error handling risk change:', error);
      // Don't throw - notification failures shouldn't block risk calculation
    }
  }

  /**
   * Update last notified risk level
   */
  private async updateLastNotifiedLevel(
    subscriptionId: string,
    riskLevel: RiskLevel
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('subscription_risk_scores')
        .update({
          last_notified_risk_level: riskLevel,
          updated_at: new Date().toISOString(),
        })
        .eq('subscription_id', subscriptionId);

      if (error) {
        throw new Error(`Failed to update last notified level: ${error.message}`);
      }

      logger.debug('Updated last notified risk level', {
        subscription_id: subscriptionId,
        risk_level: riskLevel,
      });
    } catch (error) {
      logger.error('Error updating last notified level:', error);
      throw error;
    }
  }

  /**
   * Process risk change with notification
   * This is the main entry point for risk calculation with notifications
   */
  async processRiskWithNotification(
    subscriptionId: string,
    userId: string,
    subscriptionName: string,
    subscriptionPrice: number,
    newRiskScore: RiskScore
  ): Promise<void> {
    try {
      await this.handleRiskChange(newRiskScore, subscriptionName, subscriptionPrice);
    } catch (error) {
      logger.error('Error processing risk with notification:', error);
      // Don't throw - notification failures shouldn't block the process
    }
  }
}

export const riskNotificationService = new RiskNotificationService();
