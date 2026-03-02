# Contributing to Prompt Blueprint (Spoqen)

This document defines the expected workflow for all contributors (human and agent-assisted), including setup, quality gates, and merge readiness.

## Development Principles

- Keep changes scoped and reviewable.
- Preserve the architecture constraints in `ARCHITECTURE.md`.
- Prefer incremental schema and edge-function changes over ad-hoc production edits.
- Run the required checks before opening a PR.

## Local Setup

### Prerequisites

- Node.js 20+ and npm
- PowerShell 7+ (for function deploy/smoke scripts)
- Supabase project access
- Supabase CLI for edge-function deploy workflows

### Frontend Boot

```powershell
cd app
Copy-Item .env.example .env
npm install
npm run dev
```

Required env variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`

## Branch and PR Workflow

1. Create a focused branch from `main`.
2. Implement the smallest complete change that solves the task.
3. Run the required checks for touched areas (see matrix below).
4. Update docs when behavior, setup, or architecture changes.
5. Open PR with:
   - problem statement,
   - approach summary,
   - verification evidence,
   - risk/rollback notes (if relevant).

## Required Checks Matrix

Run from `app/` unless noted.

| Change Type | Required Checks |
| --- | --- |
| Frontend/UI/Store logic | `npm run verify` |
| Prompt assembly/transcript logic | `npm run verify` |
| Edge function logic (`supabase/functions/*`) | `npm run verify` + `pwsh ./supabase/functions/test-edge-functions.ps1 -ProjectRef <ref> -AnonKey <key>` |
| Auth-sensitive edge function changes | Above + authenticated smoke: `pwsh ./supabase/functions/test-edge-functions.ps1 -ProjectRef <ref> -RequireAuth` |
| Schema/migration changes | Validate SQL in dev Supabase project + run relevant app checks (`npm run verify`) |

## Database and Migration Rules

- Add schema changes as timestamped SQL files in `supabase/migrations/`.
- Keep migrations idempotent where feasible (`if exists` / `if not exists`).
- Do not rewrite old migrations already applied to shared environments.
- If you bootstrap a fresh project via `app/supabase/migration.sql`, still ensure incremental migrations are reconciled.

## Edge Function Deployment Rules

- Use `pwsh ./supabase/functions/deploy-all-functions.ps1` as the default deploy path.
- Do not manually skip `transcript-flow-map` deployment constraints; it has a dedicated script flow in `deploy-all-functions.ps1`.
- Run smoke tests after deployment.

## Security and Secrets

- Never commit real secrets or private keys.
- Store backend secrets in Supabase function secrets.
- Keep least-privilege access in GitHub App and Supabase roles.
- Confirm production-safe auth behavior before merge.

## Agent-Assisted Contribution Expectations

- Agents must follow `AGENTS.md` and architecture constraints.
- Agent-generated changes still require human review and standard verification.
- Include the exact commands run (and outcomes) in PR notes.

## PR Checklist

- [ ] Change scope is clear and minimal.
- [ ] `npm run verify` passes in `app/`.
- [ ] Required function smoke tests were run for backend changes.
- [ ] Migration updates (if any) are added to `supabase/migrations/`.
- [ ] Docs updated (`README`, `CONTRIBUTING`, `AGENTS`, or feature docs) when behavior/setup changed.
- [ ] No secrets or sensitive tokens were committed.
