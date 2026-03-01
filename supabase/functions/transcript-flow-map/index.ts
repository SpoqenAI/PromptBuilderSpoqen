import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { generateStructuredJson, resolveDefaultGroqModel, resolveDefaultOpenAiModel } from '../_shared/llm-provider.ts';
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
  isInferred?: boolean;
  inferenceType?: string;
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

type BranchCategory = 'affirmative' | 'negative' | 'unclear' | 'other';

interface InferredBranchPlan {
  reason: string;
  inferenceType: string;
  category: BranchCategory;
}

const MIN_TRANSCRIPT_LENGTH = 20;
const MAX_TRANSCRIPT_LENGTH = 120_000;
const DEFAULT_MAX_NODES = 18;
const MAX_ALLOWED_NODES = 40;
const MIN_DECISION_BRANCH_COUNT = 2;
const INFERRED_BRANCH_REASON_CANDIDATES = [
  'No',
  'Needs clarification',
  'Escalate to support',
  'Alternative outcome',
] as const;
const AFFIRMATIVE_REASON_TOKENS = [
  'yes',
  'affirmative',
  'confirmed',
  'condition met',
  'verified',
  'approved',
  'proceed',
  'ready',
  'eligible',
  'success',
] as const;
const NEGATIVE_REASON_TOKENS = [
  'no',
  'declined',
  'decline',
  'not met',
  'not ready',
  'ineligible',
  'failed',
  'cannot',
  'unable',
  'rejected',
  'denied',
] as const;
const UNCLEAR_REASON_TOKENS = [
  'unclear',
  'unsure',
  'not sure',
  'maybe',
  'unknown',
  'needs clarification',
  'missing info',
  'missing details',
  'incomplete',
] as const;

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
            additionalProperties: false,
            required: ['nodeColor', 'speaker', 'intent', 'tag'],
            properties: {
              nodeColor: { type: ['string', 'null'] },
              speaker: { type: ['string', 'null'] },
              intent: { type: ['string', 'null'] },
              tag: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'reason', 'isInferred', 'inferenceType'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          reason: { type: 'string' },
          isInferred: { type: 'boolean' },
          inferenceType: { type: ['string', 'null'] },
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

    const configuredModel = resolveTranscriptModel();

    let flow: FlowResult;
    let usedFallback = false;
    let warning: string | null = null;
    let model = configuredModel;

    if (hasConfiguredLlmProvider()) {
      try {
        const aiResponse = await generateFlowWithLlm({
          transcript,
          existingGraph,
          maxNodes,
          assistantName,
          userName,
          model: configuredModel,
        });
        flow = normalizeFlowResult(aiResponse.payload, transcript, maxNodes, assistantName, userName);
        model = `${aiResponse.provider}:${aiResponse.model}`;
        if (aiResponse.fallbackFailures.length > 0) {
          const fallbackNote = `Recovered via provider fallback. ${sanitizeText(
            aiResponse.fallbackFailures.join(' | '),
            'Unknown provider failure.',
          )}`;
          warning = warning ? `${warning} ${fallbackNote}` : fallbackNote;
        }
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
      warning = 'No GROQ_API_KEY or OPENAI_API_KEY is configured. Using deterministic fallback mapping.';
      flow = buildFallbackFlow(transcript, maxNodes ?? MAX_ALLOWED_NODES, assistantName, userName);
    }

    const branchCompletion = ensureDecisionBranchCompleteness(flow, maxNodes ?? MAX_ALLOWED_NODES);
    flow = branchCompletion.flow;
    if (branchCompletion.addedInferredBranches > 0) {
      const completionWarning = `Added ${branchCompletion.addedInferredBranches} inferred branch${branchCompletion.addedInferredBranches === 1 ? '' : 'es'} to keep decision coverage complete.`;
      warning = warning ? `${warning} ${completionWarning}` : completionWarning;
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

async function generateFlowWithLlm(args: {
  transcript: string;
  existingGraph?: { nodes?: FlowNode[]; connections?: FlowConnection[] };
  maxNodes: number | undefined;
  assistantName: string;
  userName: string;
  model: string;
}): Promise<{ payload: unknown; provider: 'groq' | 'openai'; model: string; fallbackFailures: string[] }> {
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
            'Preserve the existing graph structure while backfilling missing plausible alternatives on decision points across the unified graph.',
            'Use your professional judgment to infer realistic branch outcomes even when they are implied instead of explicitly spoken.',
          ].join(' ')
          : [
            'You are a process flow diagram specialist. You map call center / assistant transcripts into structured process flow diagrams using BPMN / ISO 5807 conventions.',
            'Return a clean, hierarchical flow graph with concise nodes representing major states, decisions, and outcomes.',
            'Use your professional judgment to infer realistic branch outcomes beyond literal transcript wording.',
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
          'INFERENCE RULES (IMPORTANT):',
          '- Use model judgment to infer likely alternative outcomes at each decision, even when not explicitly spoken in the transcript.',
          '- This is a comprehensive branch pass: prefer broad but realistic decision coverage over narrow literal extraction.',
          '- Keep inferred branches plausible for the question/context; do NOT invent impossible domain facts.',
          '- If a decision question is binary (yes/no style) and only one side is observed, add the opposite side plus an "Unclear/Needs clarification" side.',
          '- Inferred decision branches should lead to distinct handling nodes (reuse existing compatible nodes when possible; otherwise create new inferred handling nodes).',
          '- Mark inferred branches with "isInferred": true and a concise "inferenceType" label (for example: "negative", "unclear", "missing-info", "eligibility-fail").',
          '- Every connection must include both "isInferred" and "inferenceType". For observed branches use "isInferred": false and "inferenceType": null.',
          '- Keep explicit/observed branches as-is. Inferred branches should extend coverage, not replace observed transitions.',
          '',
          'VISUAL COLORING:',
          '- Every node MUST include a "meta" object with exactly these keys: nodeColor, speaker, intent, tag.',
          '- Use null for any unknown/unused meta field.',
          '- Normal/golden-path nodes: set meta.nodeColor to null.',
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
              '- Backfill missing plausible alternatives on existing decision nodes as needed for complete decision coverage.',
              '- Do not limit branch completion to only newly introduced nodes.',
              '- Reuse existing node IDs when a step maps to an already-existing node.',
              '- Reuse existing nodes when semantically compatible before introducing new nodes.',
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

  const messages = Array.isArray(requestBody.messages)
    ? requestBody.messages
    : [];

  const response = await generateStructuredJson({
    messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    schema: FLOW_JSON_SCHEMA,
    schemaName: 'transcript_flow_graph',
    validateSchema: false,
    temperature,
    groqModel: args.model,
    openAiModel: resolveDefaultOpenAiModel(),
  });

  return response;
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
  if ((Deno.env.get('GROQ_API_KEY') ?? '').trim().length > 0) {
    return resolveDefaultGroqModel();
  }
  return resolveDefaultOpenAiModel();
}

function hasConfiguredLlmProvider(): boolean {
  return (Deno.env.get('GROQ_API_KEY') ?? '').trim().length > 0
    || (Deno.env.get('OPENAI_API_KEY') ?? '').trim().length > 0;
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

    const reason = sanitizeText(candidate.reason, '');
    const inferenceType = normalizeInferenceType(candidate.inferenceType);
    const isInferred = normalizeInferredFlag(candidate.isInferred, inferenceType);
    const key = connectionDedupeKey({
      from,
      to,
      reason,
      ...(isInferred !== undefined ? { isInferred } : {}),
      ...(inferenceType ? { inferenceType } : {}),
    });
    if (seen.has(key)) continue;

    seen.add(key);
    const normalized: FlowConnection = {
      from,
      to,
      reason,
      ...(isInferred !== undefined ? { isInferred } : {}),
      ...(inferenceType ? { inferenceType } : {}),
    };
    connections.push(normalized);
  }

  return connections;
}

function normalizeInferenceType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return undefined;
  return normalized.slice(0, 40);
}

function normalizeInferredFlag(value: unknown, inferenceType: string | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (inferenceType) return true;
  return undefined;
}

function connectionDedupeKey(connection: Pick<FlowConnection, 'from' | 'to' | 'reason' | 'isInferred' | 'inferenceType'>): string {
  const reasonKey = connection.reason.trim().toLowerCase();
  const inferenceTypeKey = (connection.inferenceType ?? '').trim().toLowerCase();
  const inferredKey = connection.isInferred === true ? '1' : connection.isInferred === false ? '0' : '';
  return `${connection.from}->${connection.to}->${reasonKey}->${inferenceTypeKey}->${inferredKey}`;
}

function ensureDecisionBranchCompleteness(
  flow: FlowResult,
  maxNodes: number,
): { flow: FlowResult; addedInferredBranches: number } {
  if (flow.nodes.length === 0) {
    return { flow, addedInferredBranches: 0 };
  }

  const nodes = [...flow.nodes];
  const connections = [...flow.connections];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenConnections = new Set(connections.map((connection) => connectionDedupeKey(connection)));
  let addedInferredBranches = 0;

  for (const node of nodes) {
    if (!isDecisionLikeNode(node)) continue;

    let outgoing = connections.filter((connection) => connection.from === node.id);
    const desiredCount = isLikelyBinaryDecisionNode(node, outgoing)
      ? 3
      : MIN_DECISION_BRANCH_COUNT;

    const plannedCoverage = inferMissingBranchPlans(node, outgoing);
    for (const plan of plannedCoverage) {
      if (hasReasonCategory(outgoing, plan.category)) continue;

      const targetId = resolveInferredTargetNodeId({
        decisionNode: node,
        decisionNodeId: node.id,
        plan,
        nodes,
        connections,
        nodeIds,
        maxNodes,
      });
      if (!targetId) continue;

      const coverageConnection: FlowConnection = {
        from: node.id,
        to: targetId,
        reason: plan.reason,
        isInferred: true,
        inferenceType: plan.inferenceType,
      };
      const dedupeKey = connectionDedupeKey(coverageConnection);
      if (seenConnections.has(dedupeKey)) {
        continue;
      }

      connections.push(coverageConnection);
      seenConnections.add(dedupeKey);
      addedInferredBranches += 1;
      outgoing = connections.filter((connection) => connection.from === node.id);
    }

    while (outgoing.length < desiredCount) {
      const plan = nextInferredBranchPlan(node, outgoing);
      const targetId = resolveInferredTargetNodeId({
        decisionNode: node,
        decisionNodeId: node.id,
        plan,
        nodes,
        connections,
        nodeIds,
        maxNodes,
      });
      if (!targetId) break;

      const inferredConnection: FlowConnection = {
        from: node.id,
        to: targetId,
        reason: plan.reason,
        isInferred: true,
        inferenceType: plan.inferenceType,
      };
      const dedupeKey = connectionDedupeKey(inferredConnection);
      if (seenConnections.has(dedupeKey)) {
        break;
      }

      connections.push(inferredConnection);
      seenConnections.add(dedupeKey);
      addedInferredBranches += 1;
      outgoing = connections.filter((connection) => connection.from === node.id);
    }
  }

  return {
    flow: {
      ...flow,
      nodes,
      connections,
    },
    addedInferredBranches,
  };
}

function isDecisionLikeNode(node: FlowNode): boolean {
  return node.type === 'decision' || node.type === 'logic-branch';
}

function nextInferredBranchPlan(decisionNode: FlowNode, outgoing: FlowConnection[]): InferredBranchPlan {
  const binaryDecision = isLikelyBinaryDecisionNode(decisionNode, outgoing);
  if (binaryDecision && !hasReasonCategory(outgoing, 'affirmative')) {
    return {
      reason: 'Yes',
      inferenceType: 'affirmative',
      category: 'affirmative',
    };
  }
  if (binaryDecision && !hasReasonCategory(outgoing, 'negative')) {
    return {
      reason: 'No',
      inferenceType: 'negative',
      category: 'negative',
    };
  }
  if (binaryDecision && !hasReasonCategory(outgoing, 'unclear')) {
    return {
      reason: 'Unclear',
      inferenceType: 'unclear',
      category: 'unclear',
    };
  }

  const reason = nextInferredBranchReason(outgoing);
  return {
    reason,
    inferenceType: toInferenceTypeLabel(reason),
    category: branchReasonCategory(reason),
  };
}

function inferMissingBranchPlans(decisionNode: FlowNode, outgoing: FlowConnection[]): InferredBranchPlan[] {
  const plans: InferredBranchPlan[] = [];

  if (isLikelyBinaryDecisionNode(decisionNode, outgoing)) {
    if (!hasReasonCategory(outgoing, 'affirmative')) {
      plans.push({
        reason: 'Yes',
        inferenceType: 'affirmative',
        category: 'affirmative',
      });
    }
    if (!hasReasonCategory(outgoing, 'negative')) {
      plans.push({
        reason: 'No',
        inferenceType: 'negative',
        category: 'negative',
      });
    }
    if (!hasReasonCategory(outgoing, 'unclear')) {
      plans.push({
        reason: 'Unclear / needs clarification',
        inferenceType: 'unclear',
        category: 'unclear',
      });
    }
    return plans;
  }

  if (hasReasonCategory(outgoing, 'affirmative') && !hasReasonCategory(outgoing, 'negative')) {
    plans.push({
      reason: 'Condition not met',
      inferenceType: 'negative',
      category: 'negative',
    });
  } else if (hasReasonCategory(outgoing, 'negative') && !hasReasonCategory(outgoing, 'affirmative')) {
    plans.push({
      reason: 'Condition met',
      inferenceType: 'affirmative',
      category: 'affirmative',
    });
  }

  if (outgoing.length < MIN_DECISION_BRANCH_COUNT && !hasReasonCategory(outgoing, 'unclear')) {
    plans.push({
      reason: 'Needs clarification',
      inferenceType: 'unclear',
      category: 'unclear',
    });
  }

  return plans;
}

function hasReasonCategory(outgoing: FlowConnection[], category: BranchCategory): boolean {
  return outgoing.some((connection) => branchReasonCategory(connection.reason) === category);
}

function nextInferredBranchReason(outgoing: FlowConnection[]): string {
  const usedReasons = new Set(
    outgoing
      .map((connection) => connection.reason.trim().toLowerCase())
      .filter((reason) => reason.length > 0),
  );

  for (const candidate of INFERRED_BRANCH_REASON_CANDIDATES) {
    const normalized = candidate.toLowerCase();
    if (!usedReasons.has(normalized)) return candidate;
  }

  return `Alternative outcome ${outgoing.length + 1}`;
}

function branchReasonCategory(reason: string): BranchCategory {
  const normalized = normalizeDecisionHintText(reason);
  if (!normalized) return 'other';

  if (containsAnyToken(normalized, NEGATIVE_REASON_TOKENS)) {
    return 'negative';
  }
  if (containsAnyToken(normalized, UNCLEAR_REASON_TOKENS)) {
    return 'unclear';
  }
  if (containsAnyToken(normalized, AFFIRMATIVE_REASON_TOKENS)) {
    return 'affirmative';
  }
  return 'other';
}

function normalizeDecisionHintText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAnyToken(normalizedText: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    const normalizedToken = normalizeDecisionHintText(token);
    return normalizedToken.length > 0 && normalizedText.includes(normalizedToken);
  });
}

function isLikelyBinaryDecisionNode(node: FlowNode, outgoing: FlowConnection[]): boolean {
  const rawText = `${node.label} ${node.content}`;
  if (/\?/.test(rawText)) return true;

  const normalized = normalizeDecisionHintText(rawText);
  const hasQuestionStyleVerb = /\b(is|are|am|do|does|did|can|could|will|would|should|have|has|had|want|agree|confirm)\b/.test(normalized);
  const hasBinaryHint = /\b(yes no|yes|no|true false|accept decline|ready not ready|eligible ineligible)\b/.test(normalized);
  if (hasQuestionStyleVerb || hasBinaryHint) return true;

  const existingCategories = new Set(outgoing.map((connection) => branchReasonCategory(connection.reason)));
  return existingCategories.has('affirmative') || existingCategories.has('negative');
}

function toInferenceTypeLabel(reason: string): string {
  const normalized = reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized.slice(0, 40) : 'alternative';
}

function resolveInferredTargetNodeId(args: {
  decisionNode: FlowNode;
  decisionNodeId: string;
  plan: InferredBranchPlan;
  nodes: FlowNode[];
  connections: FlowConnection[];
  nodeIds: Set<string>;
  maxNodes: number;
}): string | null {
  if (args.nodes.length < args.maxNodes) {
    const syntheticNode = createInferredHandlingNode(args.decisionNode, args.plan, args.nodeIds);
    args.nodes.push(syntheticNode);
    args.nodeIds.add(syntheticNode.id);
    return syntheticNode.id;
  }

  const existingOutgoing = args.connections.filter((connection) => connection.from === args.decisionNodeId);
  const categoryMatchedTarget = existingOutgoing.find((connection) => (
    connection.to !== args.decisionNodeId
    && branchReasonCategory(connection.reason) === args.plan.category
  ))?.to ?? null;
  if (categoryMatchedTarget) {
    return categoryMatchedTarget;
  }

  const reusableTarget = findReusableInferredTargetNode(args.nodes, args.decisionNodeId, args.plan.category);
  if (reusableTarget) {
    return reusableTarget;
  }

  const existingTarget = existingOutgoing.find((connection) => connection.to !== args.decisionNodeId)?.to ?? null;
  if (existingTarget) {
    return existingTarget;
  }

  const terminalTarget = args.nodes.find((node) => isTerminalNode(node) && node.id !== args.decisionNodeId)?.id ?? null;
  if (terminalTarget) {
    return terminalTarget;
  }

  const anyTarget = args.nodes.find((node) => (
    node.id !== args.decisionNodeId
    && node.type !== 'start'
    && node.type !== 'decision'
    && node.type !== 'logic-branch'
  ))?.id ?? null;
  if (anyTarget) {
    return anyTarget;
  }

  return null;
}

function findReusableInferredTargetNode(
  nodes: FlowNode[],
  decisionNodeId: string,
  category: BranchCategory,
): string | null {
  const candidates = nodes.filter((node) => (
    node.id !== decisionNodeId
    && node.type !== 'start'
    && !isDecisionLikeNode(node)
  ));

  if (category === 'negative' || category === 'unclear') {
    const escalationTarget = candidates.find((node) => node.type === 'escalation')?.id ?? null;
    if (escalationTarget) return escalationTarget;

    const terminalTarget = candidates.find((node) => isTerminalNode(node))?.id ?? null;
    if (terminalTarget) return terminalTarget;

    const coloredTarget = candidates.find((node) => {
      const color = (node.meta.nodeColor ?? '').toLowerCase();
      return color === '#ef4444' || color === '#f59e0b';
    })?.id ?? null;
    if (coloredTarget) return coloredTarget;
  }

  if (category === 'affirmative') {
    const processTarget = candidates.find((node) => (
      node.type === 'process'
      || node.type === 'subprocess'
      || node.type === 'data-lookup'
      || node.type === 'notification'
    ))?.id ?? null;
    if (processTarget) return processTarget;
  }

  return candidates[0]?.id ?? null;
}

function createInferredHandlingNode(
  decisionNode: FlowNode,
  plan: InferredBranchPlan,
  usedIds: ReadonlySet<string>,
): FlowNode {
  const id = ensureUniqueId(`${decisionNode.id}_${plan.inferenceType}`, usedIds, 'inferred_path');
  return {
    id,
    label: inferredNodeLabel(plan),
    type: 'process',
    icon: DEFAULT_ICON_BY_TYPE.process,
    content: inferredNodeContent(decisionNode, plan),
    meta: {
      nodeColor: '#F59E0B',
      speaker: 'Agent',
      intent: 'inferred-alternative',
      tag: 'inferred',
    },
  };
}

function inferredNodeLabel(plan: InferredBranchPlan): string {
  if (plan.category === 'negative') return 'Handle Negative Response';
  if (plan.category === 'unclear') return 'Clarify Caller Response';
  if (plan.category === 'affirmative') return 'Proceed After Confirmation';
  return 'Handle Alternate Outcome';
}

function inferredNodeContent(decisionNode: FlowNode, plan: InferredBranchPlan): string {
  const decisionLabel = sanitizeText(decisionNode.label, 'this decision point');
  const userDescriptor = plan.category === 'negative'
    ? 'a negative or declining response'
    : plan.category === 'unclear'
      ? 'an unclear or incomplete response'
      : plan.category === 'affirmative'
        ? 'a positive/confirming response'
        : 'an alternate response';

  return [
    `Agent: For "${decisionLabel}", handle the "${plan.reason}" branch with an appropriate follow-up and next-step guidance.`,
    `User: Provides ${userDescriptor} that requires branch-specific handling.`,
  ].join('\n');
}

function isTerminalNode(node: FlowNode): boolean {
  return node.type === 'end' || node.type === 'termination';
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
