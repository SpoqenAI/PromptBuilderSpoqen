/**
 * Supabase client — initialised from environment variables.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const rawUrl = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseUrl = rawUrl.replace(/\/+$/, '');
const supabaseKey = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars. Check .env for NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
