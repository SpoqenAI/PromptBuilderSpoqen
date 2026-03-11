/**
 * Stripe API helper for Supabase Edge Functions (Deno).
 * Uses fetch directly against the Stripe REST API to avoid SDK compatibility issues.
 */

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getStripeSecretKey(): string {
  return env('STRIPE_SECRET_KEY');
}

export function getStripeWebhookSecret(): string {
  return env('STRIPE_WEBHOOK_SECRET');
}

export function getAppPublicUrl(): string {
  return env('APP_PUBLIC_URL').replace(/\/+$/, '');
}

type StripeParams = Record<string, string | number | boolean | undefined>;

function encodeParams(params: StripeParams): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
  }
  return parts.join('&');
}

export async function stripeRequest<T>(
  method: string,
  path: string,
  params?: StripeParams,
): Promise<T> {
  const url = `https://api.stripe.com/v1${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getStripeSecretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const options: RequestInit = { method, headers };
  if (params && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = encodeParams(params);
  }

  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    const msg = body?.error?.message ?? `Stripe ${method} ${path} failed (${response.status})`;
    throw new Error(msg);
  }
  return body as T;
}

// Tier resolution from Stripe price ID
const INDIVIDUAL_PRICE_IDS = new Set(
  (Deno.env.get('STRIPE_INDIVIDUAL_PRICE_ID') ?? '').split(',').map(s => s.trim()).filter(Boolean),
);
const GROWTH_PRICE_IDS = new Set(
  (Deno.env.get('STRIPE_GROWTH_PRICE_ID') ?? '').split(',').map(s => s.trim()).filter(Boolean),
);
const ENTERPRISE_PRICE_IDS = new Set(
  (Deno.env.get('STRIPE_ENTERPRISE_PRICE_ID') ?? '').split(',').map(s => s.trim()).filter(Boolean),
);

export function resolveTier(priceId: string): 'individual' | 'growth' | 'enterprise' {
  if (ENTERPRISE_PRICE_IDS.has(priceId)) return 'enterprise';
  if (GROWTH_PRICE_IDS.has(priceId)) return 'growth';
  if (INDIVIDUAL_PRICE_IDS.has(priceId)) return 'individual';
  return 'individual';
}

export function isAllowedPriceId(priceId: string): boolean {
  if (priceId.startsWith('prod_')) {
    return false;
  }
  return INDIVIDUAL_PRICE_IDS.has(priceId) || GROWTH_PRICE_IDS.has(priceId) || ENTERPRISE_PRICE_IDS.has(priceId);
}

// Stripe webhook signature verification (HMAC-SHA256)
export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
): Promise<void> {
  const secret = getStripeWebhookSecret();
  const parts = signatureHeader.split(',');
  let timestamp = '';
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, val] = part.split('=');
    if (key === 't') timestamp = val;
    if (key === 'v1') signatures.push(val);
  }

  if (!timestamp || signatures.length === 0) {
    throw new Error('Invalid Stripe-Signature header.');
  }

  const ts = Number(timestamp);
  if (Math.abs(Date.now() / 1000 - ts) > 300) {
    throw new Error('Stripe webhook timestamp too old.');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const valid = signatures.some(sig => sig === expected);
  if (!valid) {
    throw new Error('Stripe webhook signature verification failed.');
  }
}
