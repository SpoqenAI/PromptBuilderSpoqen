# Prompt Blueprint (Spoqen)

Prompt Blueprint is a canvas-first prompt engineering workspace for building, versioning, and syncing AI prompt flows.  
It combines a Vanilla TypeScript frontend, Supabase backend services, edge-function AI workflows, and optional MCP relay tooling for coding agents.

## What This Repository Contains

- A node-based prompt canvas editor and transcript-import workspace.
- Supabase-backed persistence, auth, and row-level security policies.
- Edge functions for:
  - transcript-to-flow mapping,
  - flow-to-prompt generation,
  - prompt repair workflows,
  - GitHub App installation + prompt sync.
- Local MCP relay + connector support for agent-driven canvas edits.

## Tech Stack

- Frontend: Vite, Vanilla TypeScript, Tailwind CSS v4, Vitest
- Backend: Supabase (Postgres, Auth, Edge Functions)
- Integrations: GitHub App, OpenAI/Groq, MCP (`@modelcontextprotocol/sdk`)

## Repository Layout

- `app/`: frontend SPA and MCP relay plugin
- `app/mcp-connector/`: local MCP connector CLI (`spoqen-mcp-connector`)
- `supabase/functions/`: Supabase edge functions + deploy/smoke-test scripts
- `supabase/migrations/`: incremental database migrations
- `app/supabase/migration.sql`: baseline schema bootstrap SQL
- `ARCHITECTURE.md`: deep architecture + system behavior guide

## Local Development Setup

### 1. Prerequisites

- Node.js 20+ and npm
- PowerShell 7+ (for `.ps1` scripts)
- A Supabase project (for auth/database/functions)
- Supabase CLI (required for function deploy workflows)

### 2. Frontend Environment

From repo root:

```powershell
cd app
Copy-Item .env.example .env
```

Set at minimum:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`

Optional frontend variables:

- `NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `NEXT_PUBLIC_ENABLE_MCP_RELAY`
- `NEXT_PUBLIC_MCP_RELAY_URL`

### 3. Install and Run Frontend

```powershell
cd app
npm install
npm run dev
```

Default local URL: `http://localhost:5173/builder/`

## Testing and Quality Gates

Run from `app/`:

```powershell
npm run typecheck
npm run test
npm run build
npm run verify
```

`npm run verify` is the standard local gate (typecheck + tests + production build).

## Supabase Functions and Smoke Tests

### Project Ref Resolution

Function scripts use `supabase/.temp/project-ref` if `-ProjectRef` is not provided.

Create/update it manually if needed:

```powershell
New-Item -ItemType Directory -Force supabase/.temp | Out-Null
Set-Content -Path supabase/.temp/project-ref -Value "<your-project-ref>"
```

### Deploy Functions

Preferred:

```powershell
pwsh ./supabase/functions/deploy-all-functions.ps1 -ProjectRef <your-project-ref>
```

Optional authenticated smoke checks during deploy:

```powershell
pwsh ./supabase/functions/deploy-all-functions.ps1 -ProjectRef <your-project-ref> -RequireAuthSmoke
```

### Smoke Test Functions

Unauthenticated reachability/CORS:

```powershell
pwsh ./supabase/functions/test-edge-functions.ps1 -ProjectRef <your-project-ref> -AnonKey <your-publishable-key>
```

Authenticated checks (recommended once test credentials exist):

```powershell
$env:SUPABASE_TEST_EMAIL="you@example.com"
$env:SUPABASE_TEST_PASSWORD="your-password"
pwsh ./supabase/functions/test-edge-functions.ps1 -ProjectRef <your-project-ref> -RequireAuth
```

## Database Setup Notes

- Incremental migrations live in `supabase/migrations/` and should be applied in timestamp order.
- For fresh Supabase instances, `app/supabase/migration.sql` provides a baseline schema bootstrap.
- Additional integration/repair tables are introduced by later migrations (for example GitHub App and prompt-repair tables), so do not skip migration sync.

## Agent-Assisted Development (MCP)

To enable canvas relay in local development:

1. In `app/.env`, set `NEXT_PUBLIC_ENABLE_MCP_RELAY=true`.
2. Start the Vite dev server (`npm run dev` in `app/`).
3. Start the connector (from `app/`):

```powershell
node mcp-connector/index.js --url ws://localhost:5173/agent-relay
```

The canvas UI also shows a copy-ready connector command in-app.

## Contribution and Agent Guides

- [CONTRIBUTING.md](./CONTRIBUTING.md): branch/PR workflow, required checks, migration/function guidance
- [AGENTS.md](./AGENTS.md): coding-agent operating constraints and playbooks
- [ARCHITECTURE.md](./ARCHITECTURE.md): architecture details and domain model
- [app/README.md](./app/README.md): frontend-specific notes
- [supabase/functions/README.md](./supabase/functions/README.md): function secrets/deploy details

## Security Notes

- Never commit real credentials to `.env` files.
- Use Supabase secrets for function credentials (`GITHUB_*`, `OPENAI_*`, `GROQ_*`, etc.).
- Keep captcha enabled in production (`NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED=true`) unless you intentionally disable it for controlled environments.
