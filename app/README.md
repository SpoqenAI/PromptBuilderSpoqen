# Prompt Blueprint App

## Local setup
1. Copy `.env.example` to `.env`.
2. Fill required `NEXT_PUBLIC_*` values.
3. Install dependencies with `npm install`.
4. Run `npm run dev`.

## Quality gates
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run verify` (runs lint, test, build)

## MCP relay deployment note
- The in-repo Vite MCP relay plugin only runs in local dev.
- For production, keep `NEXT_PUBLIC_ENABLE_MCP_RELAY=false` unless you deploy a real websocket relay.
- If you deploy one, set:
  - `NEXT_PUBLIC_ENABLE_MCP_RELAY=true`
  - `NEXT_PUBLIC_MCP_RELAY_URL` to your relay origin/base path.

## Security notes
- Do not store real secrets in committed files.
- Use platform/hosted secrets for Supabase Functions (`GITHUB_*`, `OPENAI_*`, etc.).
- Keep auth captcha enabled in production (`NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED=true`).
