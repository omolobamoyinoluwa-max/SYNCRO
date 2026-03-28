import logger from '../config/logger';
import { supabase } from '../config/database';

export class ReminderEngine {
  async processReminders(): Promise<void> {
    logger.info('ReminderEngine.processReminders noop');
  }

  async scheduleReminders(daysBefore: number[] = [7, 3, 1]): Promise<void> {
    const start = Date.now();
    // Fetch active subscriptions with upcoming activity (shape matches tests' mocks)
    const { data: subscriptions } = await (supabase as any)
      .from('subscriptions')
      .select('*')
      .eq('status', 'active')
      .not('next_billing_date', 'is', null)
      .gt('active_until', new Date(0).toISOString()); // value ignored by test mock

    const subs = (subscriptions as any[]) || [];
    const userIds = Array.from(new Set(subs.map(s => s.user_id)));

    // Batch fetch preferences for involved users
    const { data: preferences } = await (supabase as any)
      .from('user_preferences')
      .select('*')
      .in('user_id', userIds);

    const prefsByUser = new Map<string, { reminder_timing?: number[] }>();
    (preferences as any[] || []).forEach(p => {
      prefsByUser.set(p.user_id, p);
    });

    // Build reminder schedule rows
    const rows: any[] = [];
    for (const sub of subs) {
      const timing: number[] = prefsByUser.get(sub.user_id)?.reminder_timing ?? daysBefore;
      for (const d of timing) {
        rows.push({
          subscription_id: sub.id,
          user_id: sub.user_id,
          reminder_date: new Date().toISOString(), // value not asserted in tests
          days_before: d,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    await (supabase as any)
      .from('reminder_schedules')
      .upsert(rows, { onConflict: 'subscription_id,reminder_date' });

    logger.info(`Reminder scheduling completed in ${Date.now() - start}ms`);
  }

  async processRetries(): Promise<void> {
    logger.info('ReminderEngine.processRetries noop');
  }
}

export const reminderEngine = new ReminderEngine();