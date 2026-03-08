import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { verifyStripeSignature, stripeRequest, resolveTier } from '../_shared/stripe.ts';

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{
      price: { id: string };
    }>;
  };
  metadata?: Record<string, string>;
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed.', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing Stripe-Signature header.', { status: 400 });
  }

  const rawBody = await req.text();

  try {
    await verifyStripeSignature(rawBody, signature);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Signature verification failed.';
    console.error('Webhook signature error:', msg);
    return new Response(msg, { status: 400 });
  }

  const event = JSON.parse(rawBody) as StripeEvent;
  const admin = createAdminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(admin, event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(admin, event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(admin, event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(admin, event.data.object);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`Webhook handler error (${event.type}):`, err);
    return new Response('Webhook handler error.', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

async function handleCheckoutCompleted(
  admin: ReturnType<typeof createAdminClient>,
  session: Record<string, unknown>,
): Promise<void> {
  const userId = session.client_reference_id as string | undefined;
  const subscriptionId = session.subscription as string | undefined;
  const customerId = session.customer as string | undefined;

  if (!userId || !subscriptionId || !customerId) {
    console.warn('checkout.session.completed missing required fields.', { userId, subscriptionId, customerId });
    return;
  }

  // Ensure stripe_customers row exists
  const { data: existing } = await admin
    .from('stripe_customers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) {
    await admin.from('stripe_customers').insert({
      user_id: userId,
      stripe_customer_id: customerId,
    });
  }

  // Fetch full subscription from Stripe
  const sub = await stripeRequest<StripeSubscription>('GET', `/subscriptions/${subscriptionId}`);
  const priceId = sub.items?.data?.[0]?.price?.id ?? '';
  const tier = sub.metadata?.tier ?? resolveTier(priceId);

  await upsertSubscription(admin, {
    userId,
    sub,
    priceId,
    tier,
  });
}

async function handleSubscriptionUpdated(
  admin: ReturnType<typeof createAdminClient>,
  obj: Record<string, unknown>,
): Promise<void> {
  const sub = obj as unknown as StripeSubscription;
  const customerId = typeof sub.customer === 'string' ? sub.customer : '';

  const { data: customerRow } = await admin
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (!customerRow) {
    console.warn('subscription.updated: no stripe_customers row for customer', customerId);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? '';
  const tier = sub.metadata?.tier ?? resolveTier(priceId);

  await upsertSubscription(admin, {
    userId: customerRow.user_id,
    sub,
    priceId,
    tier,
  });
}

async function handleSubscriptionDeleted(
  admin: ReturnType<typeof createAdminClient>,
  obj: Record<string, unknown>,
): Promise<void> {
  const sub = obj as unknown as StripeSubscription;
  await admin
    .from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id);
}

async function handlePaymentFailed(
  admin: ReturnType<typeof createAdminClient>,
  invoice: Record<string, unknown>,
): Promise<void> {
  const subscriptionId = invoice.subscription as string | undefined;
  if (!subscriptionId) return;

  await admin
    .from('subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subscriptionId);
}

interface UpsertArgs {
  userId: string;
  sub: StripeSubscription;
  priceId: string;
  tier: string;
}

async function upsertSubscription(
  admin: ReturnType<typeof createAdminClient>,
  args: UpsertArgs,
): Promise<void> {
  const { userId, sub, priceId, tier } = args;
  const now = new Date().toISOString();

  const row = {
    user_id: userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : '',
    stripe_price_id: priceId,
    status: sub.status,
    tier,
    current_period_start: sub.current_period_start
      ? new Date(sub.current_period_start * 1000).toISOString()
      : null,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: now,
  };

  const { data: existingRow } = await admin
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle();

  if (existingRow) {
    await admin
      .from('subscriptions')
      .update(row)
      .eq('stripe_subscription_id', sub.id);
  } else {
    await admin
      .from('subscriptions')
      .insert({ ...row, created_at: now });
  }
}
