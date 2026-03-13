import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowNodeType =
  | 'start' | 'end' | 'process' | 'decision'
  // Backward-compat with NodeType values from canvas/store:
  | 'core-persona' | 'mission-objective' | 'tone-guidelines' | 'language-model'
  | 'logic-branch' | 'termination' | 'vector-db' | 'static-context'
  | 'memory-buffer' | 'webhook' | 'transcriber' | 'llm-brain'
  | 'voice-synth' | 'style-module' | 'custom';

export interface TranscriptFlowNode {
  id: string;
  label: string;
  type: FlowNodeType;
  /** @deprecated — kept for backward compat with canvas/store. */
  icon?: string;
  /** @deprecated — kept for backward compat with canvas/store. */
  content?: string;
  /** @deprecated — kept for backward compat with canvas/store. */
  meta?: Record<string, string>;
}

export interface TranscriptFlowConnection {
  from: string;
  to: string;
  label?: string;
  /** @deprecated — kept for backward compat with workspace persistence. */
  reason?: string;
  /** @deprecated */
  supportCount?: number;
  /** @deprecated */
  supportRate?: number;
  /** @deprecated */
  isInferred?: boolean;
  /** @deprecated */
  inferenceType?: string;
}

export interface TranscriptFlowResult {
  title: string;
  summary: string;
  model: string;
  nodes: TranscriptFlowNode[];
  connections: TranscriptFlowConnection[];
  iterations?: number;
  toolCalls?: number;
  warning: string | null;
  /** @deprecated — kept for backward compat with store. */
  usedFallback?: boolean;
  /** @deprecated */
  coverage?: {
    coveredCharacters: number;
    totalCharacters: number;
    percentage: number;
  };
}

export interface TranscriptFlowRequest {
  transcripts: string[];
  assistantName?: string;
  userName?: string;
  /** @deprecated — kept for backward compat with canvas iteration. */
  existingGraph?: {
    nodes: TranscriptFlowNode[];
    connections: TranscriptFlowConnection[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TRANSCRIPT_LENGTH = 20;
const SUPABASE_URL = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends transcripts to the agent-based flow generation edge function.
 * The agent iteratively builds the diagram using Gemini tool-calling.
 * Returns the final diagram state.
 */
export async function generateTranscriptFlow(request: TranscriptFlowRequest): Promise<TranscriptFlowResult> {
  const transcripts = request.transcripts.map((t) => t.trim()).filter((t) => t.length >= MIN_TRANSCRIPT_LENGTH);
  if (transcripts.length === 0) {
    throw new Error(`At least one transcript must be ${MIN_TRANSCRIPT_LENGTH} characters.`);
  }
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Supabase environment is not configured for transcript generation.');
  }

  const accessToken = await resolveAccessToken();

  const payload: Record<string, unknown> = {
    transcript: transcripts.length === 1 ? transcripts[0] : undefined,
    transcripts: transcripts.length > 1 ? transcripts : undefined,
    assistantName: normalizeOptionalText(request.assistantName),
    userName: normalizeOptionalText(request.userName),
  };

  const response = await fetch(transcriptFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response));
  }

  const data = await response.json() as Record<string, unknown>;
  if (!data) {
    throw new Error('Transcript flow generation returned an empty response.');
  }

  if (typeof data.error === 'string' && data.error.trim().length > 0) {
    throw new Error(data.error);
  }

  return toTranscriptFlowResult(data);
}

// ---------------------------------------------------------------------------
// Response Normalization
// ---------------------------------------------------------------------------

function toTranscriptFlowResult(data: Record<string, unknown>): TranscriptFlowResult {
  const title = typeof data.title === 'string' ? data.title.trim() : 'Call Flow Diagram';
  const summary = typeof data.summary === 'string' ? data.summary.trim() : 'Generated from transcript.';
  const model = typeof data.model === 'string' ? data.model.trim() : 'gemini-2.5-flash-lite';
  const iterations = typeof data.iterations === 'number' ? data.iterations : 0;
  const toolCalls = typeof data.toolCalls === 'number' ? data.toolCalls : 0;
  const warning = typeof data.warning === 'string' && data.warning.trim().length > 0
    ? data.warning.trim()
    : null;

  const VALID_TYPES: FlowNodeType[] = ['start', 'end', 'process', 'decision'];

  const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
  const nodes: TranscriptFlowNode[] = rawNodes
    .filter(isRecord)
    .map((n) => ({
      id: String(n.id ?? '').trim(),
      label: String(n.label ?? '').trim() || 'Unnamed',
      type: VALID_TYPES.includes(String(n.type ?? '') as FlowNodeType)
        ? (String(n.type) as FlowNodeType)
        : 'process',
    }))
    .filter((n) => n.id.length > 0);

  const validNodeIds = new Set(nodes.map((n) => n.id));
  const rawConnections = Array.isArray(data.connections) ? data.connections : [];
  const connections: TranscriptFlowConnection[] = rawConnections
    .filter(isRecord)
    .map((c) => ({
      from: String(c.from ?? '').trim(),
      to: String(c.to ?? '').trim(),
      label: String(c.label ?? '').trim(),
    }))
    .filter((c) => c.from.length > 0 && c.to.length > 0 && c.from !== c.to)
    .filter((c) => validNodeIds.has(c.from) && validNodeIds.has(c.to));

  if (nodes.length === 0) {
    throw new Error('Agent did not produce any nodes.');
  }

  return { title, summary, model, nodes, connections, iterations, toolCalls, warning };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function transcriptFunctionUrl(): string {
  return `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/transcript-flow-map`;
}

async function resolveAccessToken(): Promise<string> {
  const sessionRes = await supabase.auth.getSession();
  if (sessionRes.error) {
    throw new Error(`Unable to read auth session: ${sessionRes.error.message}`);
  }

  let session = sessionRes.data.session;
  if (!session?.access_token) {
    throw new Error('No active session. Sign in and try again.');
  }

  const expiresAtMs = typeof session.expires_at === 'number' ? session.expires_at * 1000 : null;
  const willExpireSoon = expiresAtMs !== null && expiresAtMs - Date.now() < 60_000;
  if (willExpireSoon) {
    const refreshRes = await supabase.auth.refreshSession();
    if (refreshRes.error) {
      throw new Error(`Unable to refresh session: ${refreshRes.error.message}`);
    }
    session = refreshRes.data.session ?? session;
  }

  return session.access_token;
}

async function resolveErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string' && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Not JSON — fall through
  }
  try {
    const text = await response.text();
    if (text.trim().length > 0 && text.trim().length < 500) {
      return text.trim();
    }
  } catch {
    // Ignore
  }
  return `Request failed with status ${response.status}.`;
}
