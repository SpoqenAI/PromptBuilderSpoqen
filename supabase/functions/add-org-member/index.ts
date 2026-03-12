import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';
import { syncStripeSeatsForOrg } from '../_shared/seats.ts';
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
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';

    if (!email) return jsonResponse(400, { error: 'Email is required.' }, req);
    if (!orgId) return jsonResponse(400, { error: 'Organization ID is required.' }, req);

    // Verify caller is org owner
    const { data: org } = await admin
      .from('organizations')
      .select('id, owner_user_id')
      .eq('id', orgId)
      .maybeSingle();

    if (!org || org.owner_user_id !== user.id) {
      return jsonResponse(403, { error: 'You are not an admin of this organization.' }, req);
    }

    // Resolve target user by email
    const { data: profile } = await admin
      .from('user_profiles')
      .select('user_id')
      .eq('email', email)
      .maybeSingle();

    if (!profile) {
      // Create a pending invite instead of a direct membership
      const { error: inviteErr } = await admin.from('organization_invites').insert({
        organization_id: orgId,
        email,
        invited_by: user.id,
      });

      if (inviteErr) {
        if (inviteErr.message.includes('duplicate') || inviteErr.message.includes('unique')) {
          return jsonResponse(409, { error: 'An invite for this email already exists.' }, req);
        }
        throw inviteErr;
      }

      await syncStripeSeatsForOrg(orgId);
      return jsonResponse(200, { status: 'invited', email }, req);
    }

    if (profile.user_id === user.id) {
      return jsonResponse(400, { error: 'You cannot add yourself.' }, req);
    }

    const { error: memberErr } = await admin.from('organization_members').insert({
      organization_id: orgId,
      member_user_id: profile.user_id,
      role: 'member',
    });

    if (memberErr) {
      if (memberErr.message.includes('duplicate') || memberErr.message.includes('unique')) {
        return jsonResponse(409, { error: 'This user is already a member.' }, req);
      }
      throw memberErr;
    }

    await syncStripeSeatsForOrg(orgId);
    return jsonResponse(200, { status: 'added', userId: profile.user_id }, req);
  } catch (err) {
    await sentryCaptureError(err, { op: 'add-org-member', functionName: 'add-org-member' });
    const message = err instanceof Error ? err.message : 'Internal error.';
    const status = message.includes('Unauthorized') || message.includes('Authorization') ? 401 : 500;
    return jsonResponse(status, { error: message }, req);
  }
});
