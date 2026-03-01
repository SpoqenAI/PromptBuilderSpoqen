import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { fetchInstallationMetadata, getAllowedAppOrigin } from '../_shared/github-app.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase.ts';

interface OAuthStateRow {
  state: string;
  user_id: string;
  redirect_to: string;
  expires_at: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed.', {
      status: 405,
      headers: corsHeaders(req),
    });
  }

  const originConfig = resolveAllowedOrigin(req);
  if (!originConfig) {
    return new Response('APP_PUBLIC_URL is not configured.', {
      status: 400,
      headers: corsHeaders(req),
    });
  }
  const { allowedOrigin, fallback } = originConfig;

  try {
    const url = new URL(req.url);
    const state = (url.searchParams.get('state') ?? '').trim();
    const installationIdParam = (url.searchParams.get('installation_id') ?? '').trim();
    const installationId = Number.parseInt(installationIdParam, 10);

    if (!state || !Number.isFinite(installationId) || installationId <= 0) {
      return redirect(fallback, req);
    }

    const adminClient = createAdminClient();
    const stateRes = await adminClient
      .from('github_app_oauth_states')
      .select('state,user_id,redirect_to,expires_at')
      .eq('state', state)
      .maybeSingle();

    if (stateRes.error || !stateRes.data) {
      return redirect(fallback, req);
    }

    const oauthState = stateRes.data as OAuthStateRow;
    const expiresAt = new Date(oauthState.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      await adminClient.from('github_app_oauth_states').delete().eq('state', state);
      return redirect(safeRedirect(oauthState.redirect_to, allowedOrigin, fallback), req);
    }

    const metadata = await fetchInstallationMetadata(installationId);
    const upsertRes = await adminClient
      .from('github_installations')
      .upsert({
        user_id: oauthState.user_id,
        installation_id: installationId,
        account_login: metadata.accountLogin,
        account_type: metadata.accountType,
      });

    if (upsertRes.error) {
      throw new Error(`Failed to save GitHub installation: ${upsertRes.error.message}`);
    }

    await adminClient.from('github_app_oauth_states').delete().eq('state', state);
    return redirect(safeRedirect(oauthState.redirect_to, allowedOrigin, fallback), req);
  } catch {
    return redirect(fallback, req);
  }
});

function redirect(location: string, req: Request): Response {
  const headers = new Headers(corsHeaders(req));
  headers.set('Location', location);
  return new Response(null, {
    status: 302,
    headers,
  });
}

function safeRedirect(candidate: string, allowedOrigin: string, fallback: string): string {
  try {
    const parsed = new URL(candidate);
    if (parsed.origin !== allowedOrigin) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function resolveAllowedOrigin(req: Request): { allowedOrigin: string; fallback: string } | null {
  try {
    const allowedOrigin = getAllowedAppOrigin();
    return {
      allowedOrigin,
      fallback: `${allowedOrigin}/#/`,
    };
  } catch {
    const requestOrigin = req.headers.get('origin');
    if (!requestOrigin) return null;
    try {
      const normalized = new URL(requestOrigin).origin;
      return {
        allowedOrigin: normalized,
        fallback: `${normalized}/#/`,
      };
    } catch {
      return null;
    }
  }
}
