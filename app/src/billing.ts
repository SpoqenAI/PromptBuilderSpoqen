import { supabase } from './supabase';

export type SubscriptionTier = 'individual' | 'enterprise';
export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'trialing'
  | 'unpaid'
  | 'paused';

export interface Subscription {
  id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripePriceId: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export async function getSubscription(): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, tier, status, stripe_price_id, current_period_end, cancel_at_period_end')
    .in('status', ['active', 'trialing', 'past_due'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    tier: data.tier as SubscriptionTier,
    status: data.status as SubscriptionStatus,
    stripePriceId: data.stripe_price_id,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  };
}

function formatInvokeError(
  data: { error?: string } | null,
  error: { message?: string; name?: string } | null,
  fallback: string,
): string {
  const bodyError = data?.error?.trim();
  if (bodyError) return bodyError;
  const msg = error?.message?.trim();
  if (msg) return msg;
  return fallback;
}

/** In dev, invoke Edge Function via Vite proxy to avoid CORS. */
async function invokeFunctionDev<T = { url?: string; error?: string }>(
  name: string,
  body: object,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { data: null, error: { message: 'Not signed in.' } };
  }
  const url = `${window.location.origin}/builder/api/supabase-functions/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  if (!res.ok) {
    return { data: null, error: { message: (data as { error?: string }).error ?? res.statusText } };
  }
  return { data, error: null };
}

export async function createCheckoutSession(priceId: string): Promise<void> {
  const useProxy = import.meta.env.DEV && typeof window !== 'undefined';
  const { data, error } = useProxy
    ? await invokeFunctionDev<{ url?: string; error?: string }>('create-checkout-session', { priceId })
    : await supabase.functions.invoke<{ url?: string; error?: string }>('create-checkout-session', {
        body: { priceId },
      });

  if (error || !data?.url) {
    throw new Error(
      formatInvokeError(data, error, 'Failed to create checkout session. Check the app URL and that you are signed in.'),
    );
  }

  window.location.href = data.url;
}

export async function createCheckoutSessionByTier(tier: SubscriptionTier): Promise<void> {
  const useProxy = import.meta.env.DEV && typeof window !== 'undefined';
  const { data, error } = useProxy
    ? await invokeFunctionDev<{ url?: string; error?: string }>('create-checkout-session', { tier })
    : await supabase.functions.invoke<{ url?: string; error?: string }>('create-checkout-session', {
        body: { tier },
      });

  if (error || !data?.url) {
    throw new Error(
      formatInvokeError(data, error, 'Failed to create checkout session. Check the app URL and that you are signed in.'),
    );
  }

  window.location.href = data.url;
}

export async function createPortalSession(): Promise<void> {
  const useProxy = import.meta.env.DEV && typeof window !== 'undefined';
  const { data, error } = useProxy
    ? await invokeFunctionDev<{ url?: string; error?: string }>('create-portal-session', {})
    : await supabase.functions.invoke<{ url?: string; error?: string }>('create-portal-session', {});

  if (error || !data?.url) {
    throw new Error(
      formatInvokeError(data, error, 'Failed to open billing portal. Check the app URL and that you are signed in.'),
    );
  }

  window.location.href = data.url;
}

export function formatPeriodEnd(isoDate: string | null): string {
  if (!isoDate) return 'N/A';
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

export function tierLabel(tier: SubscriptionTier): string {
  return tier === 'enterprise' ? 'Enterprise' : 'Individual';
}

export function statusLabel(status: SubscriptionStatus): string {
  const map: Record<SubscriptionStatus, string> = {
    active: 'Active',
    trialing: 'Trial',
    past_due: 'Past due',
    canceled: 'Canceled',
    incomplete: 'Incomplete',
    incomplete_expired: 'Expired',
    unpaid: 'Unpaid',
    paused: 'Paused',
  };
  return map[status] ?? status;
}

export function statusColor(status: SubscriptionStatus): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'text-green-600 dark:text-green-400';
    case 'past_due':
    case 'unpaid':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return 'text-slate-500 dark:text-slate-400';
  }
}
