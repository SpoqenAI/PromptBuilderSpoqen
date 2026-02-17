import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createAdminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
}

function parseBearerToken(req: Request): string {
  const header = req.headers.get('Authorization');
  if (!header) throw new Error('Missing Authorization header.');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) throw new Error('Invalid Authorization header.');
  return match[1];
}

export async function requireUser(req: Request, adminClient = createAdminClient()): Promise<User> {
  const token = parseBearerToken(req);
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) {
    throw new Error('Unauthorized request.');
  }
  return data.user;
}
