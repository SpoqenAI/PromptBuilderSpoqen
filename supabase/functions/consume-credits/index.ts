import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';
import { consumeCredits } from '../_shared/credits.ts';
import { sentryCaptureError } from '../_shared/sentry.ts';

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
    const body = await req.json();
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
    const amount = typeof body.amount === 'number' ? body.amount : 0;

    if (!orgId) return jsonResponse(400, { error: 'Organization ID is required.' }, req);
    if (amount <= 0) return jsonResponse(400, { error: 'Amount must be positive.' }, req);

    // Verify caller is a member of this org
    const { data: membership } = await admin
      .from('organization_members')
      .select('id')
      .eq('organization_id', orgId)
      .eq('member_user_id', user.id)
      .maybeSingle();

    // Also allow org owner
    const { data: org } = await admin
      .from('organizations')
      .select('owner_user_id')
      .eq('id', orgId)
      .maybeSingle();

    if (!membership && org?.owner_user_id !== user.id) {
      return jsonResponse(403, { error: 'You are not a member of this organization.' }, req);
    }

    const result = await consumeCredits(orgId, amount);

    if (result === 'insufficient') {
      return jsonResponse(402, { error: 'INSUFFICIENT_CREDITS' }, req);
    }

    return jsonResponse(200, { status: 'ok' }, req);
  } catch (err) {
    await sentryCaptureError(err, { op: 'consume-credits', functionName: 'consume-credits' });
    const message = err instanceof Error ? err.message : 'Internal error.';
    const status = message.includes('Unauthorized') || message.includes('Authorization') ? 401 : 500;
    return jsonResponse(status, { error: message }, req);
  }
});
