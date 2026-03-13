# Agent Operations Guide

This guide is for coding agents and engineers collaborating with coding agents in this repository.

## Mission

Produce small, correct, verifiable changes that respect the project architecture and operational constraints.

## Required Architecture Constraints

- Frontend is Vanilla TypeScript SPA. Do not introduce React/JSX/framework runtime patterns.
- Use `store` methods for state mutation (`app/src/store.ts`); do not mutate store internals directly from views.
- Keep edge-function logic in `supabase/functions/` and schema changes in `supabase/migrations/`.
- Keep secrets out of committed files (`.env`, SQL, scripts, source).
- Preserve existing auth assumptions for edge functions and deploy via repository scripts.
- WE DO NOT USE LEGACY JWT VERIFICATION FOR SUPABASE EDGE FUNCTIONS.
- For handler-auth routes that call `requireUser(...)`, deploy with `--no-verify-jwt` and let the function verify the bearer token itself.
- If a function response contains `{"code":401,"message":"Invalid JWT"}`, treat that as a broken deployment or gateway config, not expected app behavior.

## Context Loading Order (Minimum Effective Context)

1. `README.md` (setup, commands, repo map)
2. `ARCHITECTURE.md` (system model + constraints)
3. `CONTRIBUTING.md` (quality gates and merge rules)
4. Relevant area docs:
   - `app/README.md`
   - `supabase/functions/README.md`
5. Only then open the specific source files you need to edit.

## Standard Agent Workflow

1. Identify impacted layers (frontend, edge function, schema, docs).
2. Read only files required for the current task.
3. Make minimal edits with clear intent.
4. Run required checks for touched areas.
5. Summarize:
   - files changed,
   - commands run,
   - results,
   - residual risks.

## Playbooks by Change Type

### Frontend/View/Store Changes

Run in `app/`:

```powershell
npm run verify
```

If MCP relay behavior changed, also validate relay connectivity in canvas UI.

### Edge Function Changes

1. Run frontend verification:

```powershell
cd app
npm run verify
```

2. Run function smoke tests from repo root:

```powershell
pwsh ./supabase/functions/test-edge-functions.ps1 -ProjectRef <ref> -AnonKey <key>
```

3. For auth-sensitive handlers, run authenticated smoke checks:

```powershell
pwsh ./supabase/functions/test-edge-functions.ps1 -ProjectRef <ref> -RequireAuth
```

### Schema Changes

- Add a new timestamped migration in `supabase/migrations/`.
- Keep DDL safe for repeat application when practical.
- Verify app behavior with `npm run verify` after schema-related code changes.

## MCP/Agent Relay Notes

- Relay is enabled by `NEXT_PUBLIC_ENABLE_MCP_RELAY`.
- Optional relay URL override: `NEXT_PUBLIC_MCP_RELAY_URL`.
- Local connector command (from `app/`):

```powershell
node mcp-connector/index.js --url ws://localhost:5173/agent-relay
```

## Definition of Done

A change is complete when:

- Architecture constraints are preserved.
- Required checks for touched areas pass.
- Documentation is updated for any setup/workflow/behavior changes.
- No secrets or credentials were introduced.
