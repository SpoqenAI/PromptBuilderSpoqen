export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function withCorsHeaders(headers: HeadersInit = {}): Headers {
  return new Headers({
    ...corsHeaders,
    ...headers,
  });
}

export function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: withCorsHeaders({ 'Content-Type': 'application/json' }),
  });
}
