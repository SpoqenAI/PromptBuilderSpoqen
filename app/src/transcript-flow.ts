import { supabase } from './supabase';
import type { NodeType } from './models';
import { resolveNodeIcon } from './node-icons';

export interface TranscriptFlowRequest {
  transcripts: string[];
  maxNodes?: number;
  assistantName?: string;
  userName?: string;
  onProgress?: (processed: number, total: number, partialFlow?: TranscriptFlowResult) => void;
}

export interface TranscriptFlowNode {
  id: string;
  label: string;
  type: NodeType;
  icon: string;
  content: string;
  meta: Record<string, string>;
}

export interface TranscriptFlowConnection {
  from: string;
  to: string;
  reason: string;
  supportCount?: number;
  supportRate?: number;
}

export interface TranscriptFlowResult {
  title: string;
  summary: string;
  model: string;
  nodes: TranscriptFlowNode[];
  connections: TranscriptFlowConnection[];
  usedFallback: boolean;
  warning: string | null;
}

interface TranscriptFlowApiResponse {
  title?: unknown;
  summary?: unknown;
  model?: unknown;
  nodes?: unknown;
  connections?: unknown;
  usedFallback?: unknown;
  warning?: unknown;
  error?: unknown;
}

const DEFAULT_MAX_NODES = 18;
const MIN_TRANSCRIPT_LENGTH = 20;
const MAX_BATCH_CHARS = 40_000; // stay under Edge Function's 120K limit with headroom for existingGraph JSON
const MAX_TRANSCRIPTS_PER_BATCH = 5;
const SUPABASE_URL = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';
const COVERAGE_TOKEN_MIN_LENGTH = 3;
const COVERAGE_OVERLAP_RATIO = 0.24;
const COVERAGE_MAX_TOKEN_SAMPLE = 14;
const COVERAGE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'had', 'has', 'have', 'if', 'in', 'is',
  'it', 'its', 'of', 'on', 'or', 'so', 'that', 'the', 'their', 'there', 'then', 'they', 'this', 'to', 'was',
  'were', 'will', 'with', 'you', 'your',
]);

const NODE_TYPES: readonly NodeType[] = [
  'core-persona',
  'mission-objective',
  'tone-guidelines',
  'language-model',
  'logic-branch',
  'termination',
  'vector-db',
  'static-context',
  'memory-buffer',
  'webhook',
  'transcriber',
  'llm-brain',
  'voice-synth',
  'style-module',
  'custom',
] as const;

export async function generateTranscriptFlow(request: TranscriptFlowRequest): Promise<TranscriptFlowResult> {
  const transcripts = request.transcripts.map((t) => t.trim()).filter((t) => t.length >= MIN_TRANSCRIPT_LENGTH);
  if (transcripts.length === 0) {
    throw new Error(`At least one transcript must be ${MIN_TRANSCRIPT_LENGTH} characters.`);
  }
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Supabase environment is not configured for transcript generation.');
  }

  // Process at most five transcripts per iteration and respect character budget.
  const chunks = buildTranscriptBatches(transcripts, MAX_BATCH_CHARS, MAX_TRANSCRIPTS_PER_BATCH);

  let currentFlow: TranscriptFlowResult | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const combinedTranscript = chunks[i];
    const accessToken = await resolveAccessToken();

    const payload = {
      transcript: combinedTranscript,
      existingGraph: currentFlow ? { nodes: currentFlow.nodes, connections: currentFlow.connections } : undefined,
      maxNodes: normalizeMaxNodes(request.maxNodes),
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
      throw new Error(await resolveFetchErrorMessage(response, accessToken));
    }

    const data = await response.json() as TranscriptFlowApiResponse;
    if (!data) {
      throw new Error('Transcript flow generation returned an empty response.');
    }

    if (typeof data.error === 'string' && data.error.trim().length > 0) {
      throw new Error(data.error);
    }

    currentFlow = toTranscriptFlowResult(data);
    request.onProgress?.(i + 1, chunks.length, currentFlow);
  }

  if (!currentFlow) {
    throw new Error('Failed to generate any flow.');
  }

  return addFlowCoverageMetrics(currentFlow, transcripts);
}

/**
 * Splits transcripts into batches that fit under `maxChars`.
 * If a single transcript exceeds the budget it is split at line boundaries.
 */
function buildTranscriptBatches(transcripts: string[], maxChars: number, maxTranscriptsPerBatch: number): string[] {
  const separator = '\n\n---\n\n';
  const batches: string[] = [];
  let currentParts: string[] = [];
  let currentChars = 0;

  const flushBatch = (): void => {
    if (currentParts.length === 0) return;
    batches.push(currentParts.join(separator));
    currentParts = [];
    currentChars = 0;
  };

  const addPart = (part: string): void => {
    const separatorCost = currentParts.length > 0 ? separator.length : 0;
    const nextChars = currentChars + separatorCost + part.length;
    const hitBatchCountLimit = currentParts.length >= maxTranscriptsPerBatch;
    const hitCharLimit = currentParts.length > 0 && nextChars > maxChars;
    if (hitBatchCountLimit || hitCharLimit) {
      flushBatch();
    }

    const nextSeparatorCost = currentParts.length > 0 ? separator.length : 0;
    currentChars += nextSeparatorCost + part.length;
    currentParts.push(part);
  };

  for (const transcript of transcripts) {
    // If a single transcript is larger than the budget, split it into sub-chunks.
    if (transcript.length > maxChars) {
      flushBatch();
      const lines = transcript.split('\n');
      let oversizeChunk = '';
      for (const line of lines) {
        if (oversizeChunk.length + line.length + 1 > maxChars && oversizeChunk.length > 0) {
          addPart(oversizeChunk);
          flushBatch();
          oversizeChunk = '';
        }
        oversizeChunk += (oversizeChunk.length > 0 ? '\n' : '') + line;
      }
      if (oversizeChunk.length > 0) {
        addPart(oversizeChunk);
        flushBatch();
      }
      continue;
    }

    addPart(transcript);
  }

  flushBatch();
  return batches;
}

function toTranscriptFlowResult(value: TranscriptFlowApiResponse): TranscriptFlowResult {
  const title = sanitizeText(value.title, 'Transcript Flow');
  const summary = sanitizeText(value.summary, 'Generated flow from transcript.');
  const model = sanitizeText(value.model, 'unknown');

  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const nodes: TranscriptFlowNode[] = [];
  const usedIds = new Set<string>();

  rawNodes.forEach((rawNode, index) => {
    const parsed = toTranscriptNode(rawNode, index);
    parsed.id = ensureUniqueId(parsed.id, usedIds, `node_${index + 1}`);
    usedIds.add(parsed.id);
    nodes.push(parsed);
  });

  if (nodes.length === 0) {
    throw new Error('Transcript flow generation did not return any nodes.');
  }

  const validNodeIds = new Set(nodes.map((node) => node.id));
  const connections = toTranscriptConnections(value.connections, validNodeIds);
  if (connections.length === 0 && nodes.length > 1) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      connections.push({
        from: nodes[index].id,
        to: nodes[index + 1].id,
        reason: 'Sequential call flow step',
      });
    }
  }

  return {
    title,
    summary,
    model,
    nodes,
    connections,
    usedFallback: value.usedFallback === true,
    warning: typeof value.warning === 'string' && value.warning.trim().length > 0
      ? value.warning
      : null,
  };
}

function toTranscriptNode(raw: unknown, index: number): TranscriptFlowNode {
  const node = isRecord(raw) ? raw : {};
  const type = normalizeNodeType(node.type);
  const label = sanitizeText(node.label, `Step ${index + 1}`);
  const content = sanitizeText(node.content, label);

  return {
    id: sanitizeText(node.id, `n${index + 1}`).replace(/\s+/g, '_').toLowerCase(),
    label,
    type,
    icon: normalizeIcon(node.icon, type),
    content,
    meta: normalizeMeta(node.meta),
  };
}

function toTranscriptConnections(
  rawConnections: unknown,
  validNodeIds: ReadonlySet<string>,
): TranscriptFlowConnection[] {
  if (!Array.isArray(rawConnections)) return [];

  const seen = new Set<string>();
  const normalized: TranscriptFlowConnection[] = [];

  for (const rawConnection of rawConnections) {
    if (!isRecord(rawConnection)) continue;

    const from = typeof rawConnection.from === 'string' ? rawConnection.from.trim() : '';
    const to = typeof rawConnection.to === 'string' ? rawConnection.to.trim() : '';

    if (!from || !to) continue;
    if (!validNodeIds.has(from) || !validNodeIds.has(to)) continue;
    if (from === to) continue;

    const dedupeKey = `${from}->${to}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalized.push({
      from,
      to,
      reason: sanitizeText(rawConnection.reason, ''),
      ...normalizeConnectionSupport(rawConnection),
    });
  }

  return normalized;
}

function normalizeConnectionSupport(rawConnection: Record<string, unknown>): Pick<TranscriptFlowConnection, 'supportCount' | 'supportRate'> {
  const supportCount = typeof rawConnection.supportCount === 'number' && Number.isFinite(rawConnection.supportCount)
    ? Math.max(0, Math.trunc(rawConnection.supportCount))
    : null;
  const supportRate = typeof rawConnection.supportRate === 'number' && Number.isFinite(rawConnection.supportRate)
    ? Math.max(0, Math.min(1, rawConnection.supportRate))
    : null;

  return {
    ...(supportCount !== null ? { supportCount } : {}),
    ...(supportRate !== null ? { supportRate } : {}),
  };
}

function normalizeMaxNodes(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return DEFAULT_MAX_NODES;
  const rounded = Math.trunc(value as number);
  return Math.max(6, Math.min(40, rounded));
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNodeType(value: unknown): NodeType {
  if (typeof value !== 'string') return 'custom';
  const normalized = value.trim().toLowerCase();
  if ((NODE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as NodeType;
  }

  switch (normalized) {
    // Flow-diagram types → closest prompt-builder equivalents
    case 'start':
      return 'core-persona';
    case 'end':
    case 'stop':
      return 'termination';
    case 'process':
    case 'action':
    case 'step':
      return 'static-context';
    case 'decision':
    case 'branch':
    case 'condition':
    case 'gateway':
      return 'logic-branch';
    case 'subprocess':
    case 'sub-process':
      return 'mission-objective';
    case 'escalation':
    case 'transfer':
    case 'handoff':
      return 'webhook';
    case 'data-lookup':
    case 'lookup':
    case 'query':
      return 'vector-db';
    case 'wait':
    case 'hold':
    case 'delay':
      return 'memory-buffer';
    case 'notification':
    case 'alert':
    case 'message':
      return 'style-module';
    case 'assistant':
    case 'llm':
      return 'llm-brain';
    case 'user':
    case 'input':
      return 'transcriber';
    default:
      return 'custom';
  }
}

function normalizeIcon(value: unknown, type: NodeType): string {
  return resolveNodeIcon(value, type);
}

function normalizeMeta(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([, entry]) => typeof entry === 'string')
    .map(([key, entry]) => [key, (entry as string).trim()] as const)
    .filter(([, entry]) => entry.length > 0);

  return Object.fromEntries(entries);
}

function addFlowCoverageMetrics(flow: TranscriptFlowResult, transcripts: string[]): TranscriptFlowResult {
  const totalCalls = transcripts.length;
  if (totalCalls === 0 || flow.nodes.length === 0) return flow;

  const transcriptTokenSets = transcripts.map((transcript) => new Set(tokenizeForCoverage(transcript)));
  const transcriptLower = transcripts.map((transcript) => transcript.toLowerCase());
  const tokensByNodeId = new Map<string, string[]>();
  const nodeSupport = new Map<string, number>();
  const edgeSupport = new Map<string, number>();

  for (const node of flow.nodes) {
    tokensByNodeId.set(node.id, tokensForNodeCoverage(node));
    nodeSupport.set(node.id, 0);
  }

  for (const connection of flow.connections) {
    edgeSupport.set(edgeSupportKey(connection.from, connection.to), 0);
  }

  for (let transcriptIndex = 0; transcriptIndex < transcripts.length; transcriptIndex += 1) {
    const callMatches = new Set<string>();
    const transcriptTokens = transcriptTokenSets[transcriptIndex];
    const transcriptText = transcriptLower[transcriptIndex];

    for (const node of flow.nodes) {
      const nodeTokens = tokensByNodeId.get(node.id) ?? [];
      if (!isNodeCoveredByTranscript(node, nodeTokens, transcriptTokens, transcriptText)) continue;
      callMatches.add(node.id);
      nodeSupport.set(node.id, (nodeSupport.get(node.id) ?? 0) + 1);
    }

    for (const connection of flow.connections) {
      if (!callMatches.has(connection.from) || !callMatches.has(connection.to)) continue;
      const key = edgeSupportKey(connection.from, connection.to);
      edgeSupport.set(key, (edgeSupport.get(key) ?? 0) + 1);
    }
  }

  const nodes = flow.nodes.map((node) => {
    const supportCount = nodeSupport.get(node.id) ?? 0;
    const supportRate = supportCount / totalCalls;
    return {
      ...node,
      meta: {
        ...node.meta,
        callSupport: `${supportCount}/${totalCalls}`,
        callSupportPercent: formatPercent(supportRate),
      },
    };
  });

  const connections = flow.connections.map((connection) => {
    const supportCount = edgeSupport.get(edgeSupportKey(connection.from, connection.to)) ?? 0;
    const supportRate = supportCount / totalCalls;
    return {
      ...connection,
      supportCount,
      supportRate,
    };
  });

  return {
    ...flow,
    nodes,
    connections,
  };
}

function tokensForNodeCoverage(node: TranscriptFlowNode): string[] {
  const tokens = tokenizeForCoverage(`${node.label} ${node.content}`);
  const unique = Array.from(new Set(tokens)).filter((token) => !COVERAGE_STOP_WORDS.has(token));
  unique.sort((left, right) => right.length - left.length);
  return unique.slice(0, COVERAGE_MAX_TOKEN_SAMPLE);
}

function tokenizeForCoverage(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g)
    ?.filter((token) => token.length >= COVERAGE_TOKEN_MIN_LENGTH) ?? [];
}

function isNodeCoveredByTranscript(
  node: TranscriptFlowNode,
  nodeTokens: string[],
  transcriptTokens: ReadonlySet<string>,
  transcriptLowerText: string,
): boolean {
  const normalizedLabel = node.label.trim().toLowerCase();
  if (normalizedLabel.length >= 6 && transcriptLowerText.includes(normalizedLabel)) {
    return true;
  }

  if (nodeTokens.length === 0) return false;
  const overlap = nodeTokens.reduce((count, token) => count + (transcriptTokens.has(token) ? 1 : 0), 0);
  const minHits = Math.max(1, Math.min(3, Math.ceil(nodeTokens.length * COVERAGE_OVERLAP_RATIO)));
  return overlap >= minHits;
}

function edgeSupportKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function ensureUniqueId(id: string, usedIds: ReadonlySet<string>, fallbackBase: string): string {
  const normalized = id.trim();
  const base = normalized.length > 0 ? normalized : fallbackBase;
  if (!usedIds.has(base)) return base;

  let counter = 2;
  while (usedIds.has(`${base}_${counter}`)) {
    counter += 1;
  }
  return `${base}_${counter}`;
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function resolveFetchErrorMessage(response: Response, accessToken: string): Promise<string> {
  if (response.status === 401) {
    const tokenDiagnostic = describeTokenShape(accessToken);
    const serverMessage = await readErrorText(response);
    if (serverMessage.includes('Invalid JWT')) {
      return `Auth failed for Edge Function (Invalid JWT). ${tokenDiagnostic}`;
    }
    return `Auth failed for Edge Function (${response.status}). ${tokenDiagnostic}`;
  }

  const serverMessage = await readErrorText(response);
  if (serverMessage.length > 0) {
    return serverMessage;
  }

  return `Transcript flow generation failed with status ${response.status}.`;
}

async function readErrorText(response: Response): Promise<string> {
  try {
    const body = await response.clone().json() as unknown;
    if (isRecord(body) && typeof body.error === 'string' && body.error.trim().length > 0) {
      return body.error;
    }
    if (isRecord(body) && typeof body.message === 'string' && body.message.trim().length > 0) {
      return body.message;
    }
  } catch {
    // ignore JSON parse failure
  }

  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
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

function describeTokenShape(token: string): string {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return 'Session token is malformed (not a JWT with 3 segments). Sign out/in again.';
  }

  const payload = decodeJwtPayload(segments[1]);
  if (!payload) {
    return 'Session token payload is unreadable. Sign out/in again.';
  }

  const issuer = typeof payload.iss === 'string' ? payload.iss : 'unknown-issuer';
  const audience = typeof payload.aud === 'string' ? payload.aud : 'unknown-audience';
  const exp = typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : 'unknown-exp';

  return `Token issuer: ${issuer}; audience: ${audience}; expires: ${exp}.`;
}

function decodeJwtPayload(segment: string): Record<string, unknown> | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = atob(padded);
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const transcriptFlowTestUtils = {
  buildTranscriptBatches,
  normalizeMaxNodes,
  normalizeNodeType,
  toTranscriptConnections,
};
