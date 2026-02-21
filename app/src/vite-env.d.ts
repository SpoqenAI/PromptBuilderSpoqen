/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly NEXT_PUBLIC_SUPABASE_URL?: string;
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?: string;
  readonly NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED?: string;
  readonly NEXT_PUBLIC_ENABLE_MCP_RELAY?: string;
  readonly NEXT_PUBLIC_MCP_RELAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
