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
  return normalizeOrigin(Deno.env.get('APP_PUBLIC_URL') ?? null);
}

function resolveCorsOrigin(req?: Request): string {
  const configuredOrigin = getConfiguredOrigin();
  if (!configuredOrigin) {
    return '*';
  }

  const requestOrigin = normalizeOrigin(req?.headers.get('origin') ?? null);
  if (!requestOrigin) return configuredOrigin;
  return requestOrigin === configuredOrigin ? requestOrigin : configuredOrigin;
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
