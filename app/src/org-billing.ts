/**
 * Client-side helpers for organization-level billing: seats, credits, lock dates.
 */

import { supabase } from './supabase';

export interface OrgBillingSummary {
  orgId: string;
  orgName: string;
  totalSeats: number;
  activeMembers: number;
  openSlots: number;
  monthlyCredits: number;
  topUpCredits: number;
  periodStart: string | null;
  periodEnd: string | null;
  lockDate: string | null;
  isLocked: boolean;
}

const LOCK_HOURS = 72;

export async function getOrgBillingSummary(): Promise<OrgBillingSummary | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, subscription_period_start, subscription_period_end, monthly_credits, top_up_credits')
    .eq('owner_user_id', user.id)
    .maybeSingle();

  if (!org) return null;

  const { count: memberCount } = await supabase
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id);

  const activeMembers = memberCount ?? 0;

  // Stripe quantity is mirrored via webhook/cron into subscription data;
  // for now, treat activeMembers + open slots from the org as the total.
  // The Stripe quantity can be fetched server-side for accuracy.
  const totalSeats = Math.max(activeMembers, 1);

  let lockDate: string | null = null;
  let isLocked = false;
  if (org.subscription_period_start) {
    const start = new Date(org.subscription_period_start).getTime();
    const lockMs = start + LOCK_HOURS * 60 * 60 * 1000;
    lockDate = new Date(lockMs).toISOString();
    isLocked = Date.now() >= lockMs;
  }

  return {
    orgId: org.id,
    orgName: org.name,
    totalSeats,
    activeMembers,
    openSlots: Math.max(totalSeats - activeMembers, 0),
    monthlyCredits: org.monthly_credits,
    topUpCredits: org.top_up_credits,
    periodStart: org.subscription_period_start,
    periodEnd: org.subscription_period_end,
    lockDate,
    isLocked,
  };
}

export function formatLockDate(isoDate: string | null): string {
  if (!isoDate) return 'N/A';
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoDate;
  }
}

const GRADUATED_TIERS = [
  { max: 3, price: 20 },
  { max: 10, price: 18 },
  { max: Infinity, price: 16 },
] as const;

export function getSeatUnitPrice(seatCount: number): number {
  for (const tier of GRADUATED_TIERS) {
    if (seatCount <= tier.max) return tier.price;
  }
  return 16;
}
