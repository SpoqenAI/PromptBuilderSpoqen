/**
 * Lightweight Sentry error capture for Supabase Edge Functions (Deno).
 * Uses the Sentry HTTP API directly to avoid SDK compatibility issues.
 */

const SENTRY_DSN = Deno.env.get('SENTRY_DSN') ?? '';

interface SentryContext {
  op?: string;
  orgId?: string;
  subscriptionId?: string;
  functionName?: string;
  [key: string]: string | undefined;
}

function parseDsn(dsn: string): { publicKey: string; host: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const host = url.hostname;
    const projectId = url.pathname.replace(/^\//, '');
    if (!publicKey || !host || !projectId) return null;
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

export async function sentryCaptureError(error: unknown, context: SentryContext = {}): Promise<void> {
  if (!SENTRY_DSN) {
    console.error('[sentry-stub] Error captured without DSN:', error, context);
    return;
  }

  const parsed = parseDsn(SENTRY_DSN);
  if (!parsed) {
    console.error('[sentry] Invalid DSN, cannot report:', error);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const stacktrace = error instanceof Error && error.stack
    ? { frames: error.stack.split('\n').slice(1).map(line => ({ filename: line.trim() })) }
    : undefined;

  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v !== undefined) tags[k] = v;
  }

  const envelope = JSON.stringify({
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: 'supabase-edge',
    message: { formatted: message },
    exception: {
      values: [{
        type: error instanceof Error ? error.constructor.name : 'Error',
        value: message,
        stacktrace,
      }],
    },
    tags,
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
  });

  const storeUrl = `https://${parsed.host}/api/${parsed.projectId}/store/?sentry_key=${parsed.publicKey}&sentry_version=7`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch(storeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: envelope,
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    console.error('[sentry] Failed to send event to Sentry');
  }
}
