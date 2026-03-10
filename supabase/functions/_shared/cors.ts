const DEFAULT_ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';
const DEFAULT_ALLOWED_METHODS = 'POST, GET, OPTIONS';

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function getConfiguredOrigin(): string | null {
  const url = Deno.env.get('APP_PUBLIC_URL') ?? null;
  if (url) return normalizeOrigin(url);
  const port = Deno.env.get('LOCALHOST_PORT')?.trim();
  if (port && /^\d+$/.test(port)) return `http://localhost:${port}`;
  return null;
}

/** Treat localhost and 127.0.0.1 with same path/port as equivalent for CORS. */
function originsMatch(configured: string, request: string): boolean {
  if (configured === request) return true;
  try {
    const a = new URL(configured);
    const b = new URL(request);
    if (a.port !== b.port || a.pathname !== b.pathname) return false;
    const localhost = /^localhost$/i;
    const loopback = /^127\.0\.0\.1$/;
    return (
      (localhost.test(a.hostname) && loopback.test(b.hostname)) ||
      (loopback.test(a.hostname) && localhost.test(b.hostname))
    );
  } catch {
    return false;
  }
}

/** Fallback when Origin is not forwarded and no env is set. Default Vite port. */
const LOCALHOST_ORIGIN = 'http://localhost:5173';

function resolveCorsOrigin(req?: Request): string {
  const requestOrigin = normalizeOrigin(req?.headers.get('origin') ?? null);
  if (requestOrigin) return requestOrigin;
  const configuredOrigin = getConfiguredOrigin();
  if (configuredOrigin) return configuredOrigin;
  return LOCALHOST_ORIGIN;
}

export function corsHeaders(req?: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveCorsOrigin(req),
    'Access-Control-Allow-Headers': DEFAULT_ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': DEFAULT_ALLOWED_METHODS,
    Vary: 'Origin',
  };
}

export function withCorsHeaders(headers: HeadersInit = {}, req?: Request): Headers {
  return new Headers({
    ...corsHeaders(req),
    ...headers,
  });
}

export function jsonResponse(status: number, payload: unknown, req?: Request): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: withCorsHeaders({ 'Content-Type': 'application/json' }, req),
  });
}
