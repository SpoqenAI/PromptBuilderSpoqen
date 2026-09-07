import { supabase } from './supabase';
import { getSubscription } from './billing';
import type { SubscriptionTier } from './billing';

export interface UserCredits {
  creditsRemaining: number;
  creditsAllowance: number;
  periodEnd: string | null;
}

const TIER_ALLOWANCES: Record<SubscriptionTier | 'free', number> = {
  free: 25,
  individual: 100,
  growth: 500,
  enterprise: 1000,
};

export function getAllowanceForTier(tier: SubscriptionTier | 'free'): number {
  return TIER_ALLOWANCES[tier] ?? 25;
}

export async function getUserCredits(): Promise<UserCredits> {
  const { data, error } = await supabase
    .from('user_credits')
    .select('credits_remaining, credits_allowance, period_end')
    .maybeSingle();

  if (!error && data) {
    return {
      creditsRemaining: data.credits_remaining,
      creditsAllowance: data.credits_allowance,
      periodEnd: data.period_end,
    };
  }

  const subscription = await getSubscription();
  const tier: SubscriptionTier | 'free' = subscription?.tier ?? 'free';
  const allowance = getAllowanceForTier(tier);

  const { data: initData, error: rpcError } = await supabase.rpc('get_or_init_user_credits', {
    p_tier: tier,
  });

  if (!rpcError && initData) {
    return {
      creditsRemaining: initData.credits_remaining,
      creditsAllowance: initData.credits_allowance,
      periodEnd: initData.period_end,
    };
  }

  return {
    creditsRemaining: allowance,
    creditsAllowance: allowance,
    periodEnd: null,
  };
}
