/**
 * Daily CRON function: expire stale invites, sync Stripe period timestamps,
 * and send 5-day "Downsize Opportunity" emails when seats are under-utilized.
 *
 * Trigger: Supabase scheduled function (once per day).
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { stripeRequest } from '../_shared/stripe.ts';
import { getRequiredCapacity } from '../_shared/seats.ts';
import { sentryCaptureError } from '../_shared/sentry.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'billing@spoqen.com';
const FIVE_DAYS_HOURS = 120;
const INVITE_EXPIRY_DAYS = 7;

interface StripeSubscription {
  id: string;
  current_period_start: number;
  current_period_end: number;
  items: {
    data: Array<{
      id: string;
      quantity: number;
      price: { id: string };
    }>;
  };
  metadata?: Record<string, string>;
}

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[cron] RESEND_API_KEY not set, skipping email to', to);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  } catch (err) {
    await sentryCaptureError(err, { op: 'downsize-email', functionName: 'seats-buffer-cron' });
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  const admin = createAdminClient();
  const results = { processed: 0, invitesCleaned: 0, alertsSent: 0, errors: 0 };

  try {
    // 1. Clean up expired invites (older than 7 days, not accepted)
    const expiryDate = new Date(Date.now() - INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { count: cleanedCount } = await admin
      .from('organization_invites')
      .delete({ count: 'exact' })
      .is('accepted_at', null)
      .lt('created_at', expiryDate);
    results.invitesCleaned = cleanedCount ?? 0;

    // 2. Process each org with a Stripe subscription
    const { data: orgs, error: orgsErr } = await admin
      .from('organizations')
      .select('id, owner_user_id, stripe_subscription_id, name')
      .not('stripe_subscription_id', 'is', null);

    if (orgsErr) throw orgsErr;

    for (const org of (orgs ?? [])) {
      results.processed++;
      try {
        if (!org.stripe_subscription_id) continue;

        const sub = await stripeRequest<StripeSubscription>(
          'GET',
          `/subscriptions/${org.stripe_subscription_id}`,
        );

        const periodStart = new Date(sub.current_period_start * 1000);
        const periodEnd = new Date(sub.current_period_end * 1000);
        const quantity = sub.items?.data?.[0]?.quantity ?? 0;

        // Persist period timestamps for frontend reads
        await admin
          .from('organizations')
          .update({
            subscription_period_start: periodStart.toISOString(),
            subscription_period_end: periodEnd.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', org.id);

        // 3. 5-day alert: period end is within 120 hours and there are unused seats
        const hoursToEnd = (periodEnd.getTime() - Date.now()) / 3_600_000;
        if (hoursToEnd < FIVE_DAYS_HOURS && hoursToEnd > 0) {
          const requiredCapacity = await getRequiredCapacity(org.id);
          if (requiredCapacity < quantity) {
            const periodKey = periodEnd.toISOString().slice(0, 10);

            // Deduplicate: check if alert was already sent for this period
            const { data: existingEvent } = await admin
              .from('org_billing_events')
              .select('id')
              .eq('organization_id', org.id)
              .eq('event_type', 'downsize_opportunity')
              .eq('period_key', periodKey)
              .maybeSingle();

            if (!existingEvent) {
              // Look up owner email
              const { data: ownerProfile } = await admin
                .from('user_profiles')
                .select('email, full_name')
                .eq('user_id', org.owner_user_id)
                .maybeSingle();

              if (ownerProfile?.email) {
                const orgName = org.name || 'Your organization';
                const deadline = periodEnd.toUTCString();
                const unused = quantity - requiredCapacity;

                await sendResendEmail(
                  ownerProfile.email,
                  `${orgName}: Downsize opportunity — ${unused} unused seat${unused === 1 ? '' : 's'}`,
                  `<h2>Downsize Opportunity</h2>
                   <p>Your organization <strong>${orgName}</strong> is paying for <strong>${quantity}</strong> seat${quantity === 1 ? '' : 's'} but only using <strong>${requiredCapacity}</strong>.</p>
                   <p>You have <strong>${unused}</strong> empty slot${unused === 1 ? '' : 's'} that could be freed before your period ends on <strong>${deadline}</strong>.</p>
                   <p>No action needed if you plan to fill these seats soon. Otherwise, consider downsizing to save on your next invoice.</p>`,
                );

                // Record that we sent this alert
                await admin.from('org_billing_events').insert({
                  organization_id: org.id,
                  event_type: 'downsize_opportunity',
                  period_key: periodKey,
                });

                results.alertsSent++;
              }
            }
          }
        }
      } catch (orgErr) {
        results.errors++;
        await sentryCaptureError(orgErr, {
          op: 'cron-process-org',
          orgId: org.id,
          functionName: 'seats-buffer-cron',
        });
      }
    }
  } catch (err) {
    results.errors++;
    await sentryCaptureError(err, { op: 'seats-buffer-cron-top', functionName: 'seats-buffer-cron' });
    return new Response(JSON.stringify({ error: 'CRON failed', details: results }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
