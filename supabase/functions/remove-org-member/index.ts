import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';
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
    const memberUserId = typeof body.memberUserId === 'string' ? body.memberUserId.trim() : '';

    if (!orgId) return jsonResponse(400, { error: 'Organization ID is required.' }, req);
    if (!memberUserId) return jsonResponse(400, { error: 'Member user ID is required.' }, req);

    // Verify caller is org owner
    const { data: org } = await admin
      .from('organizations')
      .select('id, owner_user_id, subscription_period_start')
      .eq('id', orgId)
      .maybeSingle();

    if (!org || org.owner_user_id !== user.id) {
      return jsonResponse(403, { error: 'You are not an admin of this organization.' }, req);
    }

    // Enforce 3-day lock: if more than 72h past period start, removal is blocked
    if (org.subscription_period_start) {
      const periodStart = new Date(org.subscription_period_start).getTime();
      const lockDate = periodStart + 72 * 60 * 60 * 1000;
      if (Date.now() >= lockDate) {
        return jsonResponse(403, {
          error: 'Seat removal is locked for the remainder of this billing period. Changes will take effect next period.',
        }, req);
      }
    }

    // Delete the membership — do NOT update Stripe (buffered seat)
    const { error: delErr } = await admin
      .from('organization_members')
      .delete()
      .eq('organization_id', orgId)
      .eq('member_user_id', memberUserId);

    if (delErr) throw delErr;

    return jsonResponse(200, { status: 'removed' }, req);
  } catch (err) {
    await sentryCaptureError(err, { op: 'remove-org-member', functionName: 'remove-org-member' });
    const message = err instanceof Error ? err.message : 'Internal error.';
    const status = message.includes('Unauthorized') || message.includes('Authorization') ? 401 : 500;
    return jsonResponse(status, { error: message }, req);
  }
});
