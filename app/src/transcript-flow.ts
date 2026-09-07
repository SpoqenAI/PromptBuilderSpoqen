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

  const normalizedGraph = enforceSingleStartAndEndNodes(nodes, connections);

  return {
    title,
    summary,
    model,
    nodes: normalizedGraph.nodes,
    connections: normalizedGraph.connections,
    iterations,
    toolCalls,
    warning,
  };
}

/**
 * Ensures that a flowchart graph contains exactly one start node and exactly one end node,
 * re-routing edges and connecting any dangling leaves to the terminal node.
 */
export function enforceSingleStartAndEndNodes(
  inputNodes: TranscriptFlowNode[],
  inputConnections: TranscriptFlowConnection[],
): { nodes: TranscriptFlowNode[]; connections: TranscriptFlowConnection[] } {
  if (inputNodes.length === 0) {
    return { nodes: [], connections: [] };
  }

  let nodes = [...inputNodes];
  let connections = [...inputConnections];

  // 1. Ensure exactly ONE start node
  let startNodes = nodes.filter((n) => n.type === 'start');
  if (startNodes.length === 0) {
    const incomingCounts = new Map<string, number>();
    for (const n of nodes) incomingCounts.set(n.id, 0);
    for (const c of connections) {
      incomingCounts.set(c.to, (incomingCounts.get(c.to) ?? 0) + 1);
    }
    const rootNode = nodes.find((n) => (incomingCounts.get(n.id) ?? 0) === 0) ?? nodes[0];
    const newStart: TranscriptFlowNode = {
      id: 'start_node',
      label: 'Call Start',
      type: 'start',
    };
    nodes.unshift(newStart);
    if (rootNode && rootNode.id !== newStart.id) {
      connections.unshift({ from: newStart.id, to: rootNode.id, label: '' });
    }
    startNodes = [newStart];
  } else if (startNodes.length > 1) {
    const primaryStart = startNodes[0];
    const extraStartIds = new Set(startNodes.slice(1).map((n) => n.id));

    connections = connections.map((conn) => {
      let from = conn.from;
      let to = conn.to;
      if (extraStartIds.has(from)) from = primaryStart.id;
      if (extraStartIds.has(to)) to = primaryStart.id;
      return { ...conn, from, to };
    });

    nodes = nodes.filter((n) => !extraStartIds.has(n.id));
  }

  // 2. Ensure exactly ONE end node
  let endNodes = nodes.filter((n) => n.type === 'end');
  let primaryEnd: TranscriptFlowNode;

  if (endNodes.length === 0) {
    primaryEnd = {
      id: 'end_node',
      label: 'Call End',
      type: 'end',
    };
    nodes.push(primaryEnd);
  } else {
    primaryEnd = endNodes[0];
    if (endNodes.length > 1) {
      const extraEndIds = new Set(endNodes.slice(1).map((n) => n.id));

      connections = connections.map((conn) => {
        let from = conn.from;
        let to = conn.to;
        if (extraEndIds.has(to)) to = primaryEnd.id;
        if (extraEndIds.has(from)) from = primaryEnd.id;
        return { ...conn, from, to };
      });

      nodes = nodes.filter((n) => !extraEndIds.has(n.id));
    }
  }

  // End node must not have outgoing edges
  connections = connections.filter((c) => c.from !== primaryEnd.id);

  // 3. Connect any dangling leaf/sink nodes (except primaryEnd itself) to primaryEnd
  const outgoingCounts = new Map<string, number>();
  for (const n of nodes) outgoingCounts.set(n.id, 0);
  for (const c of connections) {
    outgoingCounts.set(c.from, (outgoingCounts.get(c.from) ?? 0) + 1);
  }

  for (const node of nodes) {
    if (node.id === primaryEnd.id) continue;
    if ((outgoingCounts.get(node.id) ?? 0) === 0) {
      connections.push({ from: node.id, to: primaryEnd.id, label: '' });
      outgoingCounts.set(node.id, 1);
    }
  }

  // 4. Remove self-loops and duplicate edges
  const validIds = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  connections = connections.filter((c) => {
    if (c.from === c.to) return false;
    if (!validIds.has(c.from) || !validIds.has(c.to)) return false;
    const key = `${c.from}->${c.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { nodes, connections };
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
