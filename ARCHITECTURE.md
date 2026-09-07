# Prompt Blueprint (Spoqen) Architecture & Agent Guide

This document is a comprehensive, strictly grounded guide to the Prompt Builder Spoqen application. It contains zero assumptions and is intended for use by AI coding agents to fully understand the system's architecture, tools, and technical decisions.

## 1. Overview & System Philosophy

Prompt Blueprint is an application designed to manage, orchestrate, and map node-based AI prompt workflows and AI conversation transcripts. 
It features a canvas-based drag-and-drop editor for prompt graphs, integrated tools for mapping chat transcripts into flows, and an automated system for syncing to GitHub repositories.

A significant architectural decision is the **Frontend Stack**: This is a **Vanilla TypeScript** single-page application (SPA). There is no React, Vue, or Angular. All UI rendering is done via manual DOM manipulation inside view functions.

## 2. Tech Stack Summary

- **Frontend:**
  - Vite (build tool and dev server)
  - Vanilla TypeScript (DOM manipulation)
  - TailwindCSS v4
  - Custom SPA Router (hash-based or history-based manual routing)
- **Backend:**
  - Supabase (PostgreSQL database, Auth, Storage)
  - Supabase Edge Functions (Deno)
- **AI Tooling & integrations:**
  - Model Context Protocol (MCP) using `@modelcontextprotocol/sdk`
  - GitHub Apps for repository syncing
  - Groq (Llama 3.3) / OpenAI for backend AI edge functions

## 3. Directory Structure

- `/app` - The Frontend SPA.
  - `/app/src` - All frontend source code.
  - `/app/src/views` - Vanilla TS files for rendering pages (e.g., `dashboard.ts`, `canvas.ts`).
  - `/app/vite.plugin.mcp-relay.ts` - Local dev MCP WebSocket relay.
  - `/app/mcp-connector` - A Node.js CLI connector (`spoqen-mcp-connector`) that bridges MCP and the Vite relay plugin.
- `/supabase` - The Backend configuration.
  - `/supabase/functions` - Deno edge functions.
  - `/supabase/migrations` - PostgreSQL schema migrations.

## 4. Frontend Architecture

### 4.1 Rendering & Routing
The frontend initializes in `app/src/main.ts`, which sets up a custom SPA router (`app/src/router.ts`). 
Views are exported as functions that take an `HTMLElement` (usually a root container) and completely replace its `innerHTML`, then attach event listeners. 

Examples of views:
- `renderDashboard` (`views/dashboard.ts`): Lists project grids and transcript drafts.
- `renderCanvas` (`views/canvas.ts`): The node editor workspace.
- `renderEditor` (`views/editor.ts`): Single-node text content editor.

### 4.2 State Management (`store.ts`)
The application uses a centralized singleton `Store` instance (`app/src/store.ts`).
The strategy for state management is **"sync reads, async writes"**:
1. Entire user data is fetched on initialization (if authenticated).
2. The UI directly queries `store.getProjects()`, etc., synchronously.
3. Mutating calls (like `store.addNode()`) immediately update the in-memory cache (so the UI updates instantly) and kick off a background async call to Supabase.
4. If Supabase fails or is offline, the store falls back to `localStorage` caching and broadcasts a `store:remote-error` event.

## 5. Backend Architecture & Edge Functions

The backend consists entirely of Supabase services. Business logic that requires secrets (AI keys, GitHub keys) is handled by Deno Edge Functions in `/supabase/functions`.

Key Edge Functions:
- **`github-app-callback` & `github-connect-url`**: Implements standard GitHub App OAuth flow without requiring Personal Access Tokens in the UI. Mints tokens server-side.
- **`transcript-flow-map`**: Uses Gemini 2.5 Flash Lite (`GEMINI_API_KEY`, fallback to `gemini-2.0-flash`) with function/tool calling (`add_node`, `connect_nodes`, etc.) to parse unstructured conversation transcripts into deterministic node flow maps, strictly enforcing single start and end node invariants.
- **`flow-to-prompt`**: Uses Groq (`GROQ_API_KEY`, `llama-3.3-70b-versatile`) or OpenAI (`OPENAI_API_KEY`) to compile canvas node diagrams into production-ready prompts, with a deterministic rule-based fallback when no LLM key is configured.
- **`prompt-repair-run` & `apply-prompt-repair`**: Handles AI-driven modifications and patch generation for prompt flows using Groq/OpenAI.

### Deployment of Functions
Functions are strictly deployed using PowerShell scripts (e.g., `deploy-all-functions.ps1`, `deploy-transcript-flow-map.ps1`). Notably, `transcript-flow-map` and other handler-auth functions must be deployed with `--no-verify-jwt` as they manage token verification internally rather than at the Supabase API Gateway.

## 6. Data Model (PostgreSQL)

The primary tables defined in Supabase migrations include:

- **Core Application**:
  - `projects`: The top-level workflow containers.
  - `prompt_nodes`: Individual nodes in the canvas (type, content, layout x/y).
  - `connections`: Edges mapping a `from_node_id` to `to_node_id` (with optional branch labels).
  - `prompt_versions`: Snapshots of prompt states (saved as JSON).
  - `custom_nodes`: User-defined templates for reusable nodes.
- **Transcript Domain**:
  - `transcript_sets`, `transcripts`, `transcript_flows`
  - Canonical nodes and alignments for comparing structured flows to loose chat text.
- **Optimization Domain**:
  - `optimization_runs`, `optimization_run_patches`
- **Integrations & Settings**:
  - `github_installations`, `github_app_oauth_states`
  - `project_github_sync`: Per-project GitHub sync repository, branch, and target prompt path settings with row-level security.
  - `user_credits`, `organizations`: Credit ledger backed by `consume_org_credits` atomic stored procedure with row-level locks and `get_or_init_user_credits` provisioning RPC.

Data schema types are automatically generated and exist in `app/src/database.types.ts`. Sequential migrations in `supabase/migrations/` are the canonical source of truth for all schemas.

## 7. Model Context Protocol (MCP) Integration

The application natively supports local AI agents editing the canvas via the Model Context Protocol.

**How it works:**
1. A Vite plugin (`app/vite.plugin.mcp-relay.ts`) acts as a WebSocket message broker. It generates an ephemeral local session token (or respects `MCP_RELAY_SESSION_TOKEN`) and opens two routes:
   - `/canvas-sync`: Used by the browser frontend to push the current canvas state up and listen for changes.
   - `/agent-relay`: Used by local CLI tools/agents to request canvas state and send mutation commands, authenticating with the session token via `?token=...` or `x-mcp-relay-token`.
2. The `spoqen-mcp-connector` node application (in `app/mcp-connector`) runs locally on the user's machine, opening a secure connection over the MCP standard. It connects to the `/agent-relay` websocket using the session token, broadcasting the canvas state to the user's AI client, and acting on instructions to mutate the canvas layout or node properties in real-time.


## 8. General Coding Rules for AI Agents
- DO NOT use React, React hooks, or JSX. This is a Vanilla TS application. Use standard DOM (`document.createElement`, `.innerHTML`, `addEventListener`).
- State mutation must ONLY happen through methods on the `Store` instance inside `app/src/store.ts`. Do not modify `Store.projects` directly from views.
- Ensure all tailwind classes use standard tailwind conventions (e.g., utility classes like `text-slate-500`, `flex-col`, `gap-4`).
- Any new backend logic must be introduced either via Supabase migrations (`.sql` files in `supabase/migrations`) or edge functions (`supabase/functions`).
- Always run `npm run verify` (`lint`, `typecheck`, `test`, `build`) before concluding a significant task to prevent shipping broken DOM or unresolvable imports.