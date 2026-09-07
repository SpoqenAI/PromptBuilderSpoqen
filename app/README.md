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
- The in-repo Vite MCP relay plugin runs in local dev and validates session tokens to secure agent communication.
- Connect local CLI agents using:
  `node mcp-connector/index.js --url ws://localhost:5173/agent-relay --token <session-token>`
- For production, keep `NEXT_PUBLIC_ENABLE_MCP_RELAY=false` unless you deploy a real websocket relay.
- If you deploy one, set:
  - `NEXT_PUBLIC_ENABLE_MCP_RELAY=true`
  - `NEXT_PUBLIC_MCP_RELAY_URL` to your relay origin/base path.


## Optional debug ingest
- Local agent/debug ingest logging is disabled unless `NEXT_PUBLIC_AGENT_LOG_INGEST_URL` is set.
- If you enable it, point it at a running collector such as `http://127.0.0.1:7785/ingest/<session-id>`.

## Security notes
- Do not store real secrets in committed files.
- Use platform/hosted secrets for Supabase Functions (`GITHUB_*`, `OPENAI_*`, etc.).
- Keep auth captcha enabled in production (`NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED=true`).
