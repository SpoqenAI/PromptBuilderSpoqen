import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';

type FlowNodeType =
  | 'start'
  | 'end'
  | 'process'
  | 'decision'
  | 'subprocess'
  | 'escalation'
  | 'data-lookup'
  | 'wait'
  | 'notification'
  | 'core-persona'
  | 'mission-objective'
  | 'tone-guidelines'
  | 'language-model'
  | 'logic-branch'
  | 'termination'
  | 'vector-db'
  | 'static-context'
  | 'memory-buffer'
  | 'webhook'
  | 'transcriber'
  | 'llm-brain'
  | 'voice-synth'
  | 'style-module'
  | 'custom';

interface TranscriptFlowRequestBody {
  transcript?: unknown;
  existingGraph?: unknown;
  maxNodes?: unknown;
  assistantName?: unknown;
  userName?: unknown;
}

interface FlowNode {
  id: string;
  label: string;
  type: FlowNodeType;
  icon: string;
  content: string;
  meta: Record<string, string>;
}

interface FlowConnection {
  from: string;
  to: string;
  reason: string;
}

interface FlowResult {
  title: string;
  summary: string;
  nodes: FlowNode[];
  connections: FlowConnection[];
}

interface SpeakerTurn {
  speaker: string;
  text: string;
}

const MIN_TRANSCRIPT_LENGTH = 20;
const MAX_TRANSCRIPT_LENGTH = 120_000;
const DEFAULT_MAX_NODES = 18;
const MAX_ALLOWED_NODES = 40;

const FLOW_NODE_TYPES: readonly FlowNodeType[] = [
  'start',
  'end',
  'process',
  'decision',
  'subprocess',
  'escalation',
  'data-lookup',
  'wait',
  'notification',
  'logic-branch',
  'termination',
  'custom',
] as const;

const DEFAULT_ICON_BY_TYPE: Readonly<Record<FlowNodeType, string>> = {
  'start': 'play_circle',
  'end': 'stop_circle',
  'process': 'task_alt',
  'decision': 'alt_route',
  'subprocess': 'account_tree',
  'escalation': 'support_agent',
  'data-lookup': 'search',
  'wait': 'hourglass_empty',
  'notification': 'notifications',
  'logic-branch': 'alt_route',
  'termination': 'call_end',
  'core-persona': 'psychology',
  'mission-objective': 'flag',
  'tone-guidelines': 'record_voice_over',
  'language-model': 'translate',
  'vector-db': 'storage',
  'static-context': 'article',
  'memory-buffer': 'history',
  'webhook': 'integration_instructions',
  'transcriber': 'mic',
  'llm-brain': 'psychology',
  'voice-synth': 'record_voice_over',
  'style-module': 'palette',
  custom: 'widgets',
};

const CURATED_MATERIAL_ICONS = [
  'play_circle',
  'stop_circle',
  'task_alt',
  'account_tree',
  'support_agent',
  'search',
  'hourglass_empty',
  'notifications',
  'psychology',
  'flag',
  'record_voice_over',
  'translate',
  'alt_route',
  'call_end',
  'storage',
  'article',
  'history',
  'integration_instructions',
  'mic',
  'widgets',
  'hub',
  'schema',
  'bolt',
  'smart_toy',
  'terminal',
  'code',
  'memory',
  'science',
  'auto_awesome',
  'construction',
  'cloud',
  'dns',
  'extension',
  'flare',
  'functions',
  'grid_view',
  'insights',
  'key',
  'lightbulb',
  'link',
  'model_training',
  'network_check',
  'offline_bolt',
  'pending',
  'policy',
  'query_stats',
  'robot',
  'settings',
  'speed',
  'star',
  'sync',
  'timeline',
  'track_changes',
  'transform',
  'tune',
  'visibility',
  'warning',
  'wifi',
  'work',
] as const;

const ALLOWED_NODE_ICONS = new Set<string>([
  ...CURATED_MATERIAL_ICONS,
  ...Object.values(DEFAULT_ICON_BY_TYPE),
]);

const FLOW_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'nodes', 'connections'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    nodes: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_ALLOWED_NODES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'type', 'icon', 'content', 'meta'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string' },
          icon: { type: 'string' },
          content: { type: 'string' },
          meta: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'reason'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, req);
  }

  try {
    const body = await parseJson<TranscriptFlowRequestBody>(req);
    const transcript = normalizeTranscript(body.transcript);
    const maxNodes = normalizeMaxNodes(body.maxNodes);
    const assistantName = normalizeSpeakerName(body.assistantName, 'Assistant');
    const userName = normalizeSpeakerName(body.userName, 'User');
    const existingGraph = body.existingGraph as { nodes?: FlowNode[]; connections?: FlowConnection[] } | undefined;

    const adminClient = createAdminClient();
    await requireUser(req, adminClient);

    const openAiKey = (Deno.env.get('OPENAI_API_KEY') ?? '').trim();
    const configuredModel = resolveTranscriptModel();

    let flow: FlowResult;
    let usedFallback = false;
    let warning: string | null = null;
    let model = configuredModel;

    if (openAiKey) {
      try {
        const aiResponse = await generateFlowWithOpenAI({
          transcript,
          existingGraph,
          maxNodes,
          assistantName,
          userName,
          openAiKey,
          model: configuredModel,
        });
        flow = normalizeFlowResult(aiResponse, transcript, maxNodes, assistantName, userName);
      } catch (err) {
        usedFallback = true;
        model = 'deterministic-fallback';
        warning = `AI generation failed. Using deterministic fallback. ${sanitizeText(
          err instanceof Error ? err.message : String(err),
          'Unknown AI error.',
        )}`;
        flow = buildFallbackFlow(transcript, maxNodes ?? MAX_ALLOWED_NODES, assistantName, userName);
      }
    } else {
      usedFallback = true;
      model = 'deterministic-fallback';
      warning = 'OPENAI_API_KEY is not configured. Using deterministic fallback mapping.';
      flow = buildFallbackFlow(transcript, maxNodes ?? MAX_ALLOWED_NODES, assistantName, userName);
    }

    return jsonResponse(200, {
      ...flow,
      model,
      usedFallback,
      warning,
    }, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    const status = normalized.includes('unauthorized') ? 401 : 400;
    return jsonResponse(status, {
      error: message,
    }, req);
  }
});

async function parseJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

function normalizeTranscript(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Transcript is required.');
  }

  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (normalized.length < MIN_TRANSCRIPT_LENGTH) {
    throw new Error(`Transcript must be at least ${MIN_TRANSCRIPT_LENGTH} characters.`);
  }
  if (normalized.length > MAX_TRANSCRIPT_LENGTH) {
    throw new Error(`Transcript exceeds ${MAX_TRANSCRIPT_LENGTH} characters.`);
  }
  return normalized;
}

function normalizeMaxNodes(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_NODES;
  }

  const rounded = Math.trunc(value);
  return Math.max(6, Math.min(MAX_ALLOWED_NODES, rounded));
}

function normalizeSpeakerName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 40);
}

async function generateFlowWithOpenAI(args: {
  transcript: string;
  existingGraph?: { nodes?: FlowNode[]; connections?: FlowConnection[] };
  maxNodes: number | undefined;
  assistantName: string;
  userName: string;
  openAiKey: string;
  model: string;
}): Promise<unknown> {
  const temperature = resolveOptionalTemperature();
  const maxNodeLine = args.maxNodes !== undefined
    ? `Maximum node count: ${args.maxNodes}`
    : 'Use as many nodes as needed to accurately represent the conversation flow.';
  const requestBody: Record<string, unknown> = {
    model: args.model,
    messages: [
      {
        role: 'system',
        content: args.existingGraph
          ? [
            'You are a process flow diagram specialist. You map call transcripts into EXISTING flow diagrams using BPMN / ISO 5807 conventions.',
            'You will receive an existing JSON graph. Return the UNIFIED graph incorporating any new branches or edge cases found in the new transcript.',
            'Preserve the existing graph structure. Add new paths only when the transcript reveals scenarios not already covered.',
          ].join(' ')
          : [
            'You are a process flow diagram specialist. You map call center / assistant transcripts into structured process flow diagrams using BPMN / ISO 5807 conventions.',
            'Return a clean, hierarchical flow graph with concise nodes representing major states, decisions, and outcomes.',
          ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Assistant speaker label: ${args.assistantName}`,
          `User speaker label: ${args.userName}`,
          maxNodeLine,
          '',
          '=== FLOW DIAGRAM CONVENTIONS (MUST FOLLOW) ===',
          '',
          `Allowed node types: ${FLOW_NODE_TYPES.join(', ')}`,
          '',
          'TYPE DEFINITIONS:',
          '- "start"  → Entry point. Every flow MUST begin with exactly ONE start node (icon: play_circle).',
          '- "end"    → Terminal point. Use one or more end nodes for each way the call can conclude (icon: stop_circle).',
          '- "process"→ A standard action step: verify identity, look up account, process payment, etc. (icon: task_alt).',
          '- "decision"→ A branching gateway. The node label should be a Yes/No question or condition. Outgoing connections MUST have descriptive labels in the "reason" field (e.g. "Yes", "No", "After hours", "VIP customer") (icon: alt_route).',
          '- "subprocess" → A grouped sub-flow or complex procedure (icon: account_tree).',
          '- "escalation" → Transfer to a human agent, supervisor, or specialist (icon: support_agent).',
          '- "data-lookup" → CRM lookup, database query, API call, or knowledge base search (icon: search).',
          '- "wait"   → Hold, delay, callback scheduling, or async wait (icon: hourglass_empty).',
          '- "notification" → Send SMS, email, confirmation, or alert to the caller (icon: notifications).',
          '- "custom" → Use ONLY if none of the above fit.',
          '',
          'STRUCTURAL RULES:',
          '- The flow MUST start with a "start" node and terminate at "end" node(s).',
          '- Use "decision" nodes for ALL branching logic. Do NOT branch from "process" nodes.',
          '- Every "decision" node must have 2+ outgoing connections with clear condition labels in the "reason" field.',
          '- The "golden path" (most common happy path) should form the main vertical spine of the graph.',
          '- Edge cases, exceptions, and escalations should branch OFF the main spine.',
          '- Prefer DEPTH (detailed steps along the path) over BREADTH (many parallel paths).',
          '- Node ids should be stable identifiers: n1, n2, n3, etc.',
          '- Node labels should be SHORT action phrases (3-6 words): "Verify Caller Identity", "Check Account Status".',
          '- Node content should contain the detailed description or prompt text for that step.',
          '- Every node content MUST include both sides of the interaction using short sections like "Agent:" and "User:".',
          '- For open-ended user replies, bucket likely categories (for example: "Yes / No / Unclear" or "Ready / Not ready / Needs details").',
          '',
          'VISUAL COLORING:',
          '- Normal/golden-path nodes: do NOT set nodeColor in meta.',
          '- Edge case or exception nodes: set meta.nodeColor to "#F59E0B" (amber).',
          '- Escalation or error nodes: set meta.nodeColor to "#EF4444" (red).',
          '',
          'CONNECTION LABELS:',
          '- Every connection\'s "reason" field should be a concise condition or transition label.',
          '- For decision branches: use "Yes", "No", "Condition met", "Caller verified", etc.',
          '- For sequential steps: use brief descriptions like "Next", "Proceed", "After greeting".',
          ...(args.existingGraph
            ? [
              '',
              '=== EXISTING GRAPH STATE ===',
              JSON.stringify(args.existingGraph),
              '',
              '=== MERGE INSTRUCTIONS ===',
              '- Output the ENTIRE unified graph (existing nodes + any new nodes).',
              '- Do NOT delete existing nodes or connections unless absolutely necessary for flow integrity.',
              '- Add new branching paths only if the transcript introduces a scenario not already covered.',
              '- Reuse existing node IDs when a step maps to an already-existing node.',
            ]
            : []),
          '',
          '=== TRANSCRIPT ===',
          args.transcript,
        ].join('\n'),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'transcript_flow_graph',
        strict: true,
        schema: FLOW_JSON_SCHEMA,
      },
    },
  };
  if (temperature !== null) {
    requestBody.temperature = temperature;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.openAiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(extractOpenAIError(payload) ?? `OpenAI request failed with status ${response.status}.`);
  }

  const content = extractOpenAIContent(payload);
  if (!content) {
    throw new Error('OpenAI did not return structured transcript flow content.');
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error('OpenAI returned invalid JSON for transcript flow mapping.');
  }
}

function resolveOptionalTemperature(): number | null {
  const raw = (Deno.env.get('OPENAI_TRANSCRIPT_TEMPERATURE') ?? '').trim();
  if (!raw || raw.toLowerCase() === 'default') {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error('OPENAI_TRANSCRIPT_TEMPERATURE must be a valid number between 0 and 2, or "default".');
  }
  if (parsed < 0 || parsed > 2) {
    throw new Error('OPENAI_TRANSCRIPT_TEMPERATURE must be between 0 and 2, or "default".');
  }

  return parsed;
}

function resolveTranscriptModel(): string {
  return (Deno.env.get('OPENAI_TRANSCRIPT_MODEL') ?? 'gpt-5-nano').trim() || 'gpt-5-nano';
}

function extractOpenAIError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const directError = payload.error;
  if (isRecord(directError) && typeof directError.message === 'string' && directError.message.trim().length > 0) {
    return directError.message;
  }

  if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
    return payload.message;
  }

  return null;
}

function extractOpenAIContent(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return null;
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return null;
  }

  const content = firstChoice.message.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }

  if (!Array.isArray(content)) return null;

  const textParts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    const text = typeof part.text === 'string' ? part.text : '';
    if (text.trim().length > 0) {
      textParts.push(text);
    }
  }

  return textParts.length > 0 ? textParts.join('') : null;
}

function normalizeFlowResult(
  raw: unknown,
  transcript: string,
  maxNodes: number | undefined,
  assistantName: string,
  userName: string,
): FlowResult {
  if (!isRecord(raw)) {
    return buildFallbackFlow(transcript, maxNodes ?? MAX_ALLOWED_NODES, assistantName, userName);
  }

  const title = sanitizeText(raw.title, 'Transcript Flow');
  const summary = sanitizeText(raw.summary, 'Generated call flow from transcript.');

  const nodes: FlowNode[] = [];
  const ids = new Set<string>();
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const cap = maxNodes ?? MAX_ALLOWED_NODES;

  for (let index = 0; index < rawNodes.length && nodes.length < cap; index += 1) {
    const normalized = normalizeFlowNode(rawNodes[index], index, ids);
    if (!normalized) continue;
    ids.add(normalized.id);
    nodes.push(normalized);
  }

  if (nodes.length === 0) {
    return buildFallbackFlow(transcript, maxNodes ?? MAX_ALLOWED_NODES, assistantName, userName);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const connections = normalizeFlowConnections(raw.connections, nodeIds);

  if (connections.length === 0 && nodes.length > 1) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      connections.push({
        from: nodes[index].id,
        to: nodes[index + 1].id,
        reason: 'Sequential transition',
      });
    }
  }

  return {
    title,
    summary,
    nodes,
    connections,
  };
}

function normalizeFlowNode(raw: unknown, index: number, ids: ReadonlySet<string>): FlowNode | null {
  if (!isRecord(raw)) return null;

  const type = normalizeFlowNodeType(raw.type);
  const label = sanitizeText(raw.label, `Step ${index + 1}`);
  const content = sanitizeText(raw.content, label);
  const idBase = sanitizeText(raw.id, `n${index + 1}`).replace(/\s+/g, '_').toLowerCase();
  const id = ensureUniqueId(idBase, ids, `n${index + 1}`);

  return {
    id,
    label,
    type,
    icon: normalizeIcon(raw.icon, type),
    content,
    meta: normalizeMeta(raw.meta),
  };
}

function normalizeFlowConnections(raw: unknown, validNodeIds: ReadonlySet<string>): FlowConnection[] {
  if (!Array.isArray(raw)) return [];

  const connections: FlowConnection[] = [];
  const seen = new Set<string>();

  for (const candidate of raw) {
    if (!isRecord(candidate)) continue;

    const from = typeof candidate.from === 'string' ? candidate.from.trim() : '';
    const to = typeof candidate.to === 'string' ? candidate.to.trim() : '';
    if (!from || !to) continue;
    if (!validNodeIds.has(from) || !validNodeIds.has(to)) continue;
    if (from === to) continue;

    const key = `${from}->${to}`;
    if (seen.has(key)) continue;

    seen.add(key);
    connections.push({
      from,
      to,
      reason: sanitizeText(candidate.reason, ''),
    });
  }

  return connections;
}

function normalizeFlowNodeType(value: unknown): FlowNodeType {
  if (typeof value !== 'string') return 'custom';
  const normalized = value.trim().toLowerCase();
  if ((FLOW_NODE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as FlowNodeType;
  }

  switch (normalized) {
    case 'assistant':
    case 'response':
    case 'llm':
      return 'llm-brain';
    case 'user':
    case 'utterance':
    case 'input':
      return 'transcriber';
    case 'decision':
    case 'branch':
    case 'condition':
      return 'logic-branch';
    case 'end':
    case 'stop':
    case 'resolution':
      return 'termination';
    default:
      return 'custom';
  }
}

function normalizeIcon(value: unknown, type: FlowNodeType): string {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (normalized.length > 0 && normalized.length <= 32 && ALLOWED_NODE_ICONS.has(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_ICON_BY_TYPE[type];
}

function normalizeMeta(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};

  const entries = Object.entries(value)
    .filter(([, rawValue]) => typeof rawValue === 'string')
    .map(([key, rawValue]) => [key, (rawValue as string).trim()] as const)
    .filter(([, normalizedValue]) => normalizedValue.length > 0);

  return Object.fromEntries(entries);
}

function ensureUniqueId(id: string, ids: ReadonlySet<string>, fallbackBase: string): string {
  const normalized = id.trim();
  const base = normalized.length > 0 ? normalized : fallbackBase;
  if (!ids.has(base)) return base;

  let suffix = 2;
  while (ids.has(`${base}_${suffix}`)) {
    suffix += 1;
  }

  return `${base}_${suffix}`;
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function buildFallbackFlow(
  transcript: string,
  maxNodes: number,
  assistantName: string,
  userName: string,
): FlowResult {
  const turns = extractSpeakerTurns(transcript);

  const nodes: FlowNode[] = [];
  const maxConversationNodes = Math.max(1, maxNodes - 1);
  const cappedTurns = turns.slice(0, maxConversationNodes);

  for (let index = 0; index < cappedTurns.length; index += 1) {
    const turn = cappedTurns[index];
    const lowerSpeaker = turn.speaker.toLowerCase();
    const assistantMatch = lowerSpeaker === assistantName.toLowerCase();
    const userMatch = lowerSpeaker === userName.toLowerCase();

    let type: FlowNodeType;
    if (assistantMatch && /\?/.test(turn.text)) {
      type = 'logic-branch';
    } else if (assistantMatch) {
      type = 'llm-brain';
    } else if (userMatch) {
      type = 'transcriber';
    } else {
      type = 'custom';
    }

    nodes.push({
      id: `n${index + 1}`,
      label: `${turn.speaker}: ${trimForLabel(turn.text, 38)}`,
      type,
      icon: DEFAULT_ICON_BY_TYPE[type],
      content: `### ${turn.speaker}\n${turn.text}`,
      meta: {
        speaker: turn.speaker,
      },
    });
  }

  if (nodes.length === 0) {
    nodes.push({
      id: 'n1',
      label: 'Transcript Intake',
      type: 'transcriber',
      icon: DEFAULT_ICON_BY_TYPE.transcriber,
      content: transcript,
      meta: {
        source: 'fallback',
      },
    });
  }

  if (nodes.length < maxNodes) {
    nodes.push({
      id: `n${nodes.length + 1}`,
      label: 'Call Resolution',
      type: 'termination',
      icon: DEFAULT_ICON_BY_TYPE.termination,
      content: 'Conversation ends with a resolved outcome or handoff.',
      meta: {
        source: 'fallback',
      },
    });
  }

  const connections: FlowConnection[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    connections.push({
      from: nodes[index].id,
      to: nodes[index + 1].id,
      reason: 'Sequential turn progression',
    });
  }

  return {
    title: 'Transcript Flow',
    summary: summarizeTranscript(turns),
    nodes,
    connections,
  };
}

function extractSpeakerTurns(transcript: string): SpeakerTurn[] {
  const lines = transcript
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const turns: SpeakerTurn[] = [];
  const speakerPattern = /^([A-Za-z][A-Za-z0-9 _.-]{0,32})\s*:\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(speakerPattern);
    if (match) {
      turns.push({
        speaker: match[1].trim(),
        text: match[2].trim(),
      });
      continue;
    }

    if (turns.length > 0) {
      const previous = turns[turns.length - 1];
      previous.text = `${previous.text} ${line}`.trim();
      continue;
    }

    turns.push({
      speaker: 'Conversation',
      text: line,
    });
  }

  if (turns.length > 0) return turns;

  const blocks = transcript
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks.map((block) => ({
    speaker: 'Conversation',
    text: block,
  }));
}

function summarizeTranscript(turns: SpeakerTurn[]): string {
  if (turns.length === 0) {
    return 'Generated from transcript.';
  }

  const sample = turns
    .slice(0, 2)
    .map((turn) => `${turn.speaker}: ${trimForLabel(turn.text, 52)}`)
    .join(' ');

  return `Hypothetical flow derived from transcript dialogue. ${sample}`.trim();
}

function trimForLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
