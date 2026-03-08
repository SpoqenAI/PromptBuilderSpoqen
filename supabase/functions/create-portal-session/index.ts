import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';
import { stripeRequest, getAppPublicUrl } from '../_shared/stripe.ts';

interface PortalSession {
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

    const { data: customer } = await admin
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!customer?.stripe_customer_id) {
      return jsonResponse(400, { error: 'No subscription found. Please subscribe first.' }, req);
    }

    const appUrl = getAppPublicUrl();
    const session = await stripeRequest<PortalSession>(
      'POST',
      '/billing_portal/sessions',
      {
        customer: customer.stripe_customer_id,
        return_url: `${appUrl}/builder/#/billing`,
      },
    );

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
