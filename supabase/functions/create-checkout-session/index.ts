import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';
import { stripeRequest, getAppPublicUrl, isAllowedPriceId, resolveTier } from '../_shared/stripe.ts';

interface CheckoutRequestBody {
  priceId?: unknown;
  tier?: unknown;
}

interface StripeCustomer {
  id: string;
  email?: string;
}

interface StripeCheckoutSession {
  id: string;
  url: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, req);
  }

  try {
    const admin = createAdminClient();
    const user = await requireUser(req, admin);
    const body = (await req.json()) as CheckoutRequestBody;

    let priceId = typeof body.priceId === 'string' ? body.priceId.trim() : '';

    if (!priceId && typeof body.tier === 'string') {
      const tierEnvKey = body.tier === 'enterprise'
        ? 'STRIPE_ENTERPRISE_PRICE_ID'
        : 'STRIPE_INDIVIDUAL_PRICE_ID';
      const envVal = Deno.env.get(tierEnvKey) ?? '';
      priceId = envVal.split(',')[0]?.trim() ?? '';
    }

    if (!priceId || !isAllowedPriceId(priceId)) {
      const message = priceId.startsWith('prod_')
        ? 'Stripe Product ID (prod_...) was provided; use a Price ID (price_...) instead. In Stripe Dashboard open your product, copy the Price ID from the Pricing section, and set STRIPE_INDIVIDUAL_PRICE_ID / STRIPE_ENTERPRISE_PRICE_ID in Supabase secrets.'
        : 'Invalid or missing price ID.';
      return jsonResponse(400, { error: message }, req);
    }

    // Look up or create Stripe Customer
    const { data: existingCustomer } = await admin
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let stripeCustomerId: string;
    if (existingCustomer?.stripe_customer_id) {
      stripeCustomerId = existingCustomer.stripe_customer_id;
    } else {
      const email = user.email ?? '';
      const customer = await stripeRequest<StripeCustomer>('POST', '/customers', {
        email,
        'metadata[supabase_user_id]': user.id,
      });
      stripeCustomerId = customer.id;

      await admin.from('stripe_customers').insert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
      });
    }

    const appUrl = getAppPublicUrl();
    const tier = resolveTier(priceId);
    const session = await stripeRequest<StripeCheckoutSession>('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer: stripeCustomerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      success_url: `${appUrl}/builder/#/billing?success=1`,
      cancel_url: `${appUrl}/builder/#/billing?canceled=1`,
      client_reference_id: user.id,
      'metadata[tier]': tier,
      'subscription_data[metadata][tier]': tier,
      'subscription_data[metadata][supabase_user_id]': user.id,
    });

    return jsonResponse(200, { url: session.url }, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error.';
    const status =
      message === 'Unauthorized request.' || message === 'Missing Authorization header.'
        ? 401
        : 500;
    return jsonResponse(status, { error: message }, req);
  }
});
