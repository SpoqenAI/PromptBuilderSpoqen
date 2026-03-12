/**
 * Buffered seat management utilities for org-based billing.
 * Handles graduated pricing, capacity calculation, and Stripe sync.
 */

import { createAdminClient } from './supabase.ts';
import { stripeRequest } from './stripe.ts';
import { sentryCaptureError } from './sentry.ts';

interface StripeSubscription {
  id: string;
  items: {
    data: Array<{
      id: string;
      quantity: number;
      price: { id: string };
    }>;
  };
  current_period_start: number;
  current_period_end: number;
  metadata?: Record<string, string>;
}

/**
 * Graduated pricing tiers (per seat/month).
 * 1-3 seats: $20, 4-10 seats: $18, 11+ seats: $16.
 */
export function getSeatUnitPriceForCount(count: number): number {
  if (count <= 3) return 20;
  if (count <= 10) return 18;
  return 16;
}

/**
 * Compute Total Count = Active Members + Pending (non-expired) Invites.
 * Invites older than 7 days are considered expired.
 */
export async function getRequiredCapacity(orgId: string): Promise<number> {
  const admin = createAdminClient();

  const [membersRes, invitesRes] = await Promise.all([
    admin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId),
    admin
      .from('organization_invites')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .is('accepted_at', null)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const activeMembers = membersRes.count ?? 0;
  const pendingInvites = invitesRes.count ?? 0;
  return activeMembers + pendingInvites;
}

/**
 * Only increase Stripe subscription quantity when required capacity exceeds
 * the current Stripe quantity. Never decreases (buffered seats).
 * Uses proration_behavior: 'always_invoice' for seat additions.
 */
export async function syncStripeSeatsForOrg(orgId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('stripe_subscription_id')
    .eq('id', orgId)
    .maybeSingle();

  if (orgError || !org?.stripe_subscription_id) return;

  try {
    const sub = await stripeRequest<StripeSubscription>(
      'GET',
      `/subscriptions/${org.stripe_subscription_id}`,
    );

    const item = sub.items?.data?.[0];
    if (!item) return;

    const currentQuantity = item.quantity ?? 0;
    const requiredCapacity = await getRequiredCapacity(orgId);

    if (requiredCapacity > currentQuantity) {
      await stripeRequest('POST', `/subscriptions/${sub.id}`, {
        [`items[0][id]`]: item.id,
        [`items[0][quantity]`]: requiredCapacity,
        proration_behavior: 'always_invoice',
      });
    }
  } catch (err) {
    await sentryCaptureError(err, { op: 'syncStripeSeatsForOrg', orgId, functionName: 'seats' });
    throw err;
  }
}

/**
 * Fetch the Stripe subscription for an org and return period timestamps.
 */
export async function getOrgSubscriptionPeriod(orgId: string): Promise<{
  periodStart: Date;
  periodEnd: Date;
  quantity: number;
} | null> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from('organizations')
    .select('stripe_subscription_id')
    .eq('id', orgId)
    .maybeSingle();

  if (!org?.stripe_subscription_id) return null;

  try {
    const sub = await stripeRequest<StripeSubscription>(
      'GET',
      `/subscriptions/${org.stripe_subscription_id}`,
    );
    return {
      periodStart: new Date(sub.current_period_start * 1000),
      periodEnd: new Date(sub.current_period_end * 1000),
      quantity: sub.items?.data?.[0]?.quantity ?? 0,
    };
  } catch (err) {
    await sentryCaptureError(err, { op: 'getOrgSubscriptionPeriod', orgId });
    return null;
  }
}
