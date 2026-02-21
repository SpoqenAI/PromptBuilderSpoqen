import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { getAllowedAppOrigin, getGitHubAppSlug } from '../_shared/github-app.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';

interface ConnectUrlBody {
  redirectTo?: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, req);
  }

  try {
    const adminClient = createAdminClient();
    const user = await requireUser(req, adminClient);
    const body = await parseJson<ConnectUrlBody>(req);

    const allowedOrigin = getAllowedAppOrigin();
    const redirectTo = normalizeRedirectTo(body.redirectTo, allowedOrigin);
    const state = generateState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const insertRes = await adminClient
      .from('github_app_oauth_states')
      .insert({
        state,
        user_id: user.id,
        redirect_to: redirectTo,
        expires_at: expiresAt,
      });

    if (insertRes.error) {
      throw new Error(`Failed to store OAuth state: ${insertRes.error.message}`);
    }

    const appSlug = getGitHubAppSlug();
    const connectUrl = `https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`;
    return jsonResponse(200, { url: connectUrl }, req);
  } catch (err) {
    return jsonResponse(400, {
      error: err instanceof Error ? err.message : String(err),
    }, req);
  }
});

async function parseJson<T>(req: Request): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    return {} as T;
  }
}

function generateState(): string {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
}

function normalizeRedirectTo(value: string | undefined, allowedOrigin: string): string {
  const fallback = `${allowedOrigin}/#/`;
  if (!value || value.trim().length === 0) return fallback;

  try {
    const parsed = new URL(value);
    if (parsed.origin !== allowedOrigin) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}
