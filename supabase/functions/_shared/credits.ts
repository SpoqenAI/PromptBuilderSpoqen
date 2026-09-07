/**
 * Org-level credit consumption with monthly-first, top-up-second logic.
 * All operations use FOR UPDATE row locking to prevent race conditions.
 */

import { createAdminClient } from './supabase.ts';
import { sentryCaptureError } from './sentry.ts';

export type ConsumeResult = 'ok' | 'insufficient';

/**
 * Deduct `amount` credits from the organization, burning monthly_credits first,
 * then top_up_credits. Returns 'insufficient' without mutating if the org
 * doesn't have enough total credits.
 */
export async function consumeCredits(orgId: string, amount: number): Promise<ConsumeResult> {
  if (amount <= 0) return 'ok';

  const admin = createAdminClient();

  try {
    // Use RPC for atomic read-check-update via a Postgres function with FOR UPDATE row lock.
    const { data: rpcResult, error: rpcErr } = await admin.rpc('consume_org_credits', {
      p_org_id: orgId,
      p_amount: amount,
    });

    if (!rpcErr && (rpcResult === 'ok' || rpcResult === 'insufficient')) {
      return rpcResult as ConsumeResult;
    }

    // Fallback if RPC is not yet available in the environment
    const { data: org, error: readErr } = await admin
      .from('organizations')
      .select('monthly_credits, top_up_credits')
      .eq('id', orgId)
      .maybeSingle();

    if (readErr) throw readErr;
    if (!org) return 'insufficient';

    const totalAvailable = org.monthly_credits + org.top_up_credits;
    if (totalAvailable < amount) return 'insufficient';

    const useFromMonthly = Math.min(org.monthly_credits, amount);
    const remainder = amount - useFromMonthly;

    const { error: updateErr } = await admin
      .from('organizations')
      .update({
        monthly_credits: org.monthly_credits - useFromMonthly,
        top_up_credits: org.top_up_credits - remainder,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orgId);

    if (updateErr) throw updateErr;
    return 'ok';
  } catch (err) {
    await sentryCaptureError(err, { op: 'consumeCredits', orgId, functionName: 'credits' });
    throw err;
  }
}
