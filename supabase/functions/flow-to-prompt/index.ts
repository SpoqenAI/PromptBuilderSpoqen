import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { generateStructuredJson, resolveDefaultGroqModel, resolveDefaultOpenAiModel } from '../_shared/llm-provider.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';

interface RequestBody {
  transcriptSetId?: unknown;
  projectId?: unknown;
  mode?: unknown;
}

interface CanonicalNode {
  id: string;
  label: string;
  type: string;
  content: string;
  supportCount: number;
}

interface CanonicalEdge {
  from: string;
  to: string;
  reason: string;
  supportCount: number;
  transitionRate: number;
  isInferred?: boolean;
  inferenceType?: string;
}

interface PromptNode {
  id: string;
  label: string;
  type: string;
  content: string;
}

interface PromptCompilationResult {
  promptMarkdown: string;
  model: string;
  usedFallback: boolean;
  warning: string | null;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'if', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'with', 'you',
]);

const PROMPT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['promptMarkdown'],
  properties: {
    promptMarkdown: { type: 'string' },
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
    const body = await parseJson<RequestBody>(req);
    const transcriptSetId = normalizeId(body.transcriptSetId, 'transcriptSetId');
    const projectId = normalizeOptionalId(body.projectId);
    const mode = normalizeMode(body.mode);

    const admin = createAdminClient();
    const user = await requireUser(req, admin);

    const ownsSet = await admin
      .from('transcript_sets')
      .select('id')
      .eq('id', transcriptSetId)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (ownsSet.error) {
      throw new Error(`Failed to verify transcript set access: ${ownsSet.error.message}`);
    }
    if (!ownsSet.data) {
      throw new Error('Transcript set not found.');
    }

    const flowData = await loadCanonicalFlow(admin, transcriptSetId);
    if (flowData.nodes.length === 0) {
      throw new Error('No canonical flow nodes found for this transcript set.');
    }

    const orderedNodes = orderCanonicalNodes(flowData.nodes, flowData.edges);
    const compiled = await compilePromptFromFlow(orderedNodes, flowData.edges, mode);

    let mappings: Array<{
      canonicalNodeId: string;
      promptNodeId?: string;
      sectionHeading: string;
    }> = orderedNodes.map((node, index) => ({
      canonicalNodeId: node.id,
      sectionHeading: `${index + 1}. ${node.label}`,
    }));

    if (projectId) {
      const ownsProject = await admin
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (ownsProject.error) {
        throw new Error(`Failed to verify project access: ${ownsProject.error.message}`);
      }
      if (!ownsProject.data) {
        throw new Error('Project not found.');
      }
      const promptNodes = await loadPromptNodes(admin, projectId);
      mappings = buildMappings(orderedNodes, promptNodes);
    }

    return jsonResponse(200, {
      promptMarkdown: compiled.promptMarkdown,
      nodeMappings: mappings,
      model: compiled.model,
      usedFallback: compiled.usedFallback,
      warning: compiled.warning,
    }, req);
  } catch (err) {
    return jsonResponse(400, {
      error: err instanceof Error ? err.message : String(err),
    }, req);
  }
});

async function parseJson<T>(req: Request): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    return {} as T;
  }
}

function normalizeId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeMode(value: unknown): 'runtime' | 'flow-template' {
  if (value === 'flow-template') return 'flow-template';
  return 'runtime';
}

async function loadCanonicalFlow(
  admin: ReturnType<typeof createAdminClient>,
  transcriptSetId: string,
): Promise<{ nodes: CanonicalNode[]; edges: CanonicalEdge[] }> {
  const nodesRes = await admin
    .from('canonical_flow_nodes')
    .select('id, label, type, content, support_count')
    .eq('transcript_set_id', transcriptSetId);
  if (nodesRes.error) {
    throw new Error(`Failed to load canonical nodes: ${nodesRes.error.message}`);
  }

  const edgesRes = await admin
    .from('canonical_flow_edges')
    .select('from_node_id, to_node_id, reason, support_count, transition_rate')
    .eq('transcript_set_id', transcriptSetId);
  if (edgesRes.error) {
    throw new Error(`Failed to load canonical edges: ${edgesRes.error.message}`);
  }

  const nodes: CanonicalNode[] = (nodesRes.data ?? []).map((row) => ({
    id: row.id,
    label: normalizeText(row.label, 'Untitled step'),
    type: normalizeText(row.type, 'custom'),
    content: normalizeText(row.content, row.label || 'Step'),
    supportCount: toNonNegativeInt(row.support_count),
  }));
  const edges: CanonicalEdge[] = (edgesRes.data ?? []).map((row) => ({
    from: row.from_node_id,
    to: row.to_node_id,
    reason: normalizeText(row.reason, 'Next'),
    supportCount: toNonNegativeInt(row.support_count),
    transitionRate: clamp01(toFiniteNumber(row.transition_rate)),
  }));

  const fallbackFlow = await loadLatestTranscriptFlow(admin, transcriptSetId);
  if (nodes.length > 0) {
    if (!fallbackFlow) {
      return { nodes, edges };
    }

    const validNodeIds = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: mergeEdgeVariants(edges, fallbackFlow.edges, validNodeIds),
    };
  }

  if (!fallbackFlow) {
    return { nodes: [], edges: [] };
  }

  return {
    nodes: fallbackFlow.nodes,
    edges: fallbackFlow.edges,
  };
}

async function loadLatestTranscriptFlow(
  admin: ReturnType<typeof createAdminClient>,
  transcriptSetId: string,
): Promise<{ nodes: CanonicalNode[]; edges: CanonicalEdge[] } | null> {
  const transcriptsRes = await admin
    .from('transcripts')
    .select('id')
    .eq('transcript_set_id', transcriptSetId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (transcriptsRes.error) {
    throw new Error(`Failed to load transcripts: ${transcriptsRes.error.message}`);
  }

  const transcriptIds = (transcriptsRes.data ?? []).map((row) => row.id);
  if (transcriptIds.length === 0) {
    return null;
  }

  const flowRes = await admin
    .from('transcript_flows')
    .select('nodes_json, connections_json')
    .in('transcript_id', transcriptIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (flowRes.error) {
    throw new Error(`Failed to load transcript flow fallback: ${flowRes.error.message}`);
  }
  if (!flowRes.data) {
    return null;
  }

  return {
    nodes: parseFallbackNodes(flowRes.data.nodes_json),
    edges: parseFallbackEdges(flowRes.data.connections_json),
  };
}

function parseFallbackNodes(raw: unknown): CanonicalNode[] {
  if (!Array.isArray(raw)) return [];
  const output: CanonicalNode[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = normalizeText(item.id, '');
    if (!id) continue;
    const label = normalizeText(item.label, 'Untitled step');
    output.push({
      id,
      label,
      type: normalizeText(item.type, 'custom'),
      content: normalizeText(item.content, label),
      supportCount: toNonNegativeInt(item.supportCount),
    });
  }
  return output;
}

function parseFallbackEdges(raw: unknown): CanonicalEdge[] {
  if (!Array.isArray(raw)) return [];
  const output: CanonicalEdge[] = [];
  const dedupe = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const from = normalizeText(item.from, '');
    const to = normalizeText(item.to, '');
    if (!from || !to) continue;
    const reason = normalizeText(item.reason, 'Next');
    const inferenceType = normalizeInferenceType(item.inferenceType);
    const isInferred = normalizeInferredFlag(item.isInferred, inferenceType);
    const key = edgeKey({
      from,
      to,
      reason,
      ...(typeof isInferred === 'boolean' ? { isInferred } : {}),
      ...(inferenceType ? { inferenceType } : {}),
    });
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    output.push({
      from,
      to,
      reason,
      supportCount: toNonNegativeInt(item.supportCount),
      transitionRate: clamp01(
        toFiniteNumber(
          item.supportRate ?? item.transitionRate ?? item.transition_rate,
        ),
      ),
      ...(typeof isInferred === 'boolean' ? { isInferred } : {}),
      ...(inferenceType ? { inferenceType } : {}),
    });
  }
  return output;
}

function orderCanonicalNodes(nodes: CanonicalNode[], edges: CanonicalEdge[]): CanonicalNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) continue;
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const visited = new Set<string>();
  const ordered: CanonicalNode[] = [];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    ordered.push(node);

    for (const target of outgoing.get(id) ?? []) {
      const nextCount = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, nextCount);
      if (nextCount <= 0) {
        queue.push(target);
      }
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      ordered.push(node);
    }
  }

  return ordered;
}

async function compilePromptFromFlow(
  nodes: CanonicalNode[],
  edges: CanonicalEdge[],
  mode: 'runtime' | 'flow-template',
): Promise<PromptCompilationResult> {
  if (hasConfiguredLlmProvider()) {
    try {
      const generated = await generatePromptWithLlm(nodes, edges, mode);
      return {
        promptMarkdown: generated.promptMarkdown,
        model: generated.model,
        usedFallback: false,
        warning: generated.warning,
      };
    } catch (err) {
      const fallback = assembleDeterministicVoicePrompt(nodes, edges, mode);
      return {
        promptMarkdown: fallback,
        model: 'deterministic-flow-compiler',
        usedFallback: true,
        warning: `LLM prompt synthesis failed. Returned deterministic prompt. ${sanitizeError(
          err instanceof Error ? err.message : String(err),
        )}`,
      };
    }
  }

  return {
    promptMarkdown: assembleDeterministicVoicePrompt(nodes, edges, mode),
    model: 'deterministic-flow-compiler',
    usedFallback: true,
    warning: 'No GROQ_API_KEY or OPENAI_API_KEY configured. Returned deterministic prompt.',
  };
}

async function generatePromptWithLlm(
  nodes: CanonicalNode[],
  edges: CanonicalEdge[],
  mode: 'runtime' | 'flow-template',
): Promise<{ promptMarkdown: string; model: string; warning: string | null }> {
  const temperature = resolveOptionalTemperature();
  const flowContext = buildFlowContext(nodes, edges, mode);
  const result = await generateStructuredJson({
    messages: [
      {
        role: 'system',
        content: [
          'You are a senior voice AI prompt architect.',
          'Convert a conversation flow graph into a production-ready system prompt.',
          'Write behavior and policy instructions, not a static line-by-line script.',
          'The final prompt must let the agent adapt naturally while preserving flow intent and branch logic.',
          'Return JSON only.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Target mode: ${mode}`,
          '',
          'Prompt requirements:',
          '- Output markdown suitable as a single system prompt.',
          '- Include sections for persona, mission, operating rules, flow state machine, branch handling, escalation/recovery, and voice style.',
          '- Represent branch behavior as decision policies the agent can execute in real conversations.',
          '- For inferred branches, describe them as plausible alternatives (for example: negative response, unclear response, missing information).',
          '- Keep concrete anchors to the flow graph (state labels and branch conditions) so the behavior stays faithful to the source flow.',
          '- Never write it as a rigid call script with fixed turns.',
          '',
          'Canonical flow JSON:',
          flowContext,
        ].join('\n'),
      },
    ],
    schema: PROMPT_JSON_SCHEMA,
    schemaName: 'voice_agent_prompt',
    validateSchema: false,
    temperature,
    maxTokens: mode === 'flow-template' ? 2600 : 1800,
    groqModel: resolveDefaultGroqModel(),
    openAiModel: resolveDefaultOpenAiModel(),
  });

  const rawPrompt = extractPromptMarkdown(result.payload);
  const promptMarkdown = normalizePromptMarkdown(rawPrompt);
  if (!promptMarkdown) {
    throw new Error('LLM response returned empty promptMarkdown.');
  }

  return {
    promptMarkdown,
    model: `${result.provider}:${result.model}`,
    warning: result.fallbackFailures.length > 0
      ? `Recovered via provider fallback. ${sanitizeError(result.fallbackFailures.join(' | '))}`
      : null,
  };
}

function extractPromptMarkdown(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!isRecord(payload)) return '';

  const direct = payload.promptMarkdown;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct;
  }

  const underscore = payload.prompt_markdown;
  if (typeof underscore === 'string' && underscore.trim().length > 0) {
    return underscore;
  }

  const markdown = payload.markdown;
  if (typeof markdown === 'string' && markdown.trim().length >= 300) {
    return markdown;
  }

  const prompt = payload.prompt;
  if (typeof prompt === 'string' && prompt.trim().length >= 300) {
    return prompt;
  }

  return '';
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

function buildFlowContext(
  nodes: CanonicalNode[],
  edges: CanonicalEdge[],
  mode: 'runtime' | 'flow-template',
): string {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingByNode = new Map<string, CanonicalEdge[]>();
  for (const edge of edges) {
    const bucket = outgoingByNode.get(edge.from) ?? [];
    bucket.push(edge);
    outgoingByNode.set(edge.from, bucket);
  }

  const context = {
    mode,
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      supportCount: node.supportCount,
      content: clipText(node.content, 520),
      outgoing: (outgoingByNode.get(node.id) ?? []).map((edge) => ({
        to: edge.to,
        targetLabel: nodeById.get(edge.to)?.label ?? edge.to,
        reason: edge.reason,
        supportCount: edge.supportCount,
        transitionRate: edge.transitionRate,
        isInferred: edge.isInferred === true,
        inferenceType: edge.inferenceType ?? null,
      })),
    })),
    edges: edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      reason: edge.reason,
      supportCount: edge.supportCount,
      transitionRate: edge.transitionRate,
      isInferred: edge.isInferred === true,
      inferenceType: edge.inferenceType ?? null,
    })),
  };

  return JSON.stringify(context, null, 2);
}

function assembleDeterministicVoicePrompt(
  nodes: CanonicalNode[],
  edges: CanonicalEdge[],
  mode: 'runtime' | 'flow-template',
): string {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingByNode = new Map<string, CanonicalEdge[]>();
  for (const edge of edges) {
    const bucket = outgoingByNode.get(edge.from) ?? [];
    bucket.push(edge);
    outgoingByNode.set(edge.from, bucket);
  }

  const startNode = nodes.find((node) => node.type === 'start') ?? nodes[0];
  const personaSignals = collectSignals(nodes, ['core-persona', 'tone-guidelines', 'language-model', 'style-module']);
  const missionSignals = collectSignals(nodes, ['mission-objective', 'process', 'start']);

  const lines: string[] = [];
  lines.push('# Voice Agent System Prompt');
  lines.push('');
  lines.push('You are a real-time voice AI agent. Treat this prompt as an operational policy, not a fixed script.');
  lines.push('Adapt wording to the caller while preserving intent, branch logic, and outcomes defined in the flow.');
  lines.push('');
  lines.push('## Identity and Persona');
  lines.push(personaSignals || 'Adopt a clear, calm, professional voice and stay conversational.');
  lines.push('');
  lines.push('## Mission');
  lines.push(missionSignals || 'Guide the caller through the flow, resolve the request, and close cleanly.');
  lines.push('');
  lines.push('## Operating Rules');
  lines.push('1. Start in the entry state and move through states based on user intent and branch conditions.');
  lines.push('2. Ask clarifying questions when user intent is ambiguous before committing to a branch.');
  lines.push('3. Use concise responses, confirm key details, and keep momentum toward resolution.');
  lines.push('4. If required data is missing, collect it explicitly and route to the proper branch.');
  lines.push('5. Escalate when policy or capability boundaries are reached.');
  lines.push('');
  lines.push('## State Machine');
  lines.push(`Start state: ${startNode.label} (${startNode.id})`);
  lines.push('');

  for (const node of nodes) {
    lines.push(`### ${node.label} (${node.id})`);
    lines.push(`Type: ${node.type}`);
    lines.push(`Policy: ${toPolicySummary(node.content, node.label)}`);
    const outgoing = outgoingByNode.get(node.id) ?? [];
    if (outgoing.length === 0) {
      lines.push('Transitions: [end]');
    } else {
      lines.push('Transitions:');
      for (const edge of outgoing) {
        const targetLabel = nodeById.get(edge.to)?.label ?? edge.to;
        const inferredSuffix = edge.isInferred === true
          ? ` (inferred${edge.inferenceType ? `:${edge.inferenceType}` : ''})`
          : '';
        lines.push(`- If "${edge.reason || 'Next'}" then go to ${targetLabel} (${edge.to})${inferredSuffix}.`);
      }
    }
    lines.push('');
  }

  const branchNodes = nodes.filter((node) => (outgoingByNode.get(node.id) ?? []).length > 1);
  lines.push('## Branch Handling');
  if (branchNodes.length === 0) {
    lines.push('Use a single-path conversation and close when completion criteria are met.');
  } else {
    for (const node of branchNodes) {
      const outgoing = outgoingByNode.get(node.id) ?? [];
      const branchList = outgoing.map((edge) => edge.reason || 'Next').join(', ');
      lines.push(`- At "${node.label}" evaluate: ${branchList}. Ask targeted follow-ups when user intent is unclear.`);
    }
  }
  lines.push('');
  lines.push('## Escalation and Recovery');
  lines.push('Escalate to a human when the user requests escalation, when policy blocks completion, or when repeated attempts fail.');
  lines.push('If the user goes off-path, restate the current goal and guide them to the nearest valid state.');
  lines.push('');
  lines.push('## Voice Style');
  lines.push('Keep language natural, confident, and concise. Confirm decisions before high-impact actions.');
  if (mode === 'flow-template') {
    lines.push('Expose branch conditions explicitly in your reasoning so this prompt remains auditable against the flow map.');
  }

  return lines.join('\n').trim();
}

function collectSignals(nodes: CanonicalNode[], preferredTypes: string[]): string {
  const picked = nodes
    .filter((node) => preferredTypes.includes(node.type))
    .slice(0, 3)
    .map((node) => toPolicySummary(node.content, node.label))
    .filter((entry) => entry.length > 0);
  return picked.join(' ');
}

function toPolicySummary(content: string, fallback: string): string {
  const normalized = content
    .replace(/\s+/g, ' ')
    .replace(/\b(assistant|agent|user)\s*:/gi, '')
    .trim();
  if (!normalized) return fallback;
  const clipped = clipText(normalized, 260);
  return clipped || fallback;
}

function mergeEdgeVariants(
  primary: CanonicalEdge[],
  supplemental: CanonicalEdge[],
  validNodeIds: ReadonlySet<string>,
): CanonicalEdge[] {
  const merged: CanonicalEdge[] = [];
  const seen = new Set<string>();

  const append = (candidate: CanonicalEdge): void => {
    if (!candidate.from || !candidate.to || candidate.from === candidate.to) return;
    if (!validNodeIds.has(candidate.from) || !validNodeIds.has(candidate.to)) return;
    const key = edgeKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(candidate);
  };

  for (const edge of primary) append(edge);
  for (const edge of supplemental) append(edge);

  return merged;
}

function edgeKey(edge: Pick<CanonicalEdge, 'from' | 'to' | 'reason' | 'isInferred' | 'inferenceType'>): string {
  const normalizedReason = normalizeText(edge.reason, 'next').toLowerCase();
  const normalizedInferenceType = normalizeInferenceType(edge.inferenceType);
  const inferredToken = edge.isInferred === true ? '1' : edge.isInferred === false ? '0' : '';
  return `${edge.from}->${edge.to}->${normalizedReason}->${normalizedInferenceType}->${inferredToken}`;
}

function normalizeInferenceType(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function normalizeInferredFlag(value: unknown, inferenceType: string): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (inferenceType.length > 0) return true;
  return undefined;
}

function hasConfiguredLlmProvider(): boolean {
  return (Deno.env.get('GROQ_API_KEY') ?? '').trim().length > 0
    || (Deno.env.get('OPENAI_API_KEY') ?? '').trim().length > 0;
}

function normalizePromptMarkdown(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\r\n?/g, '\n');
}

function sanitizeError(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Unknown LLM error.';
  return normalized.slice(0, 280);
}

function clipText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toNonNegativeInt(value: unknown): number {
  const parsed = toFiniteNumber(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

async function loadPromptNodes(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<PromptNode[]> {
  const res = await admin
    .from('prompt_nodes')
    .select('id, label, type, content, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (res.error) {
    throw new Error(`Failed to load prompt nodes: ${res.error.message}`);
  }

  return (res.data ?? []).map((row) => ({
    id: row.id,
    label: normalizeText(row.label, 'Untitled prompt node'),
    type: normalizeText(row.type, 'custom'),
    content: normalizeText(row.content, ''),
  }));
}

function buildMappings(canonicalNodes: CanonicalNode[], promptNodes: PromptNode[]): Array<{
  canonicalNodeId: string;
  promptNodeId?: string;
  sectionHeading: string;
}> {
  const mappings: Array<{
    canonicalNodeId: string;
    promptNodeId?: string;
    sectionHeading: string;
  }> = [];

  for (let i = 0; i < canonicalNodes.length; i += 1) {
    const canonical = canonicalNodes[i];
    let bestPromptId: string | undefined;
    let bestScore = 0;
    for (const promptNode of promptNodes) {
      const score = similarityScore(
        `${canonical.label} ${canonical.content}`,
        `${promptNode.label} ${promptNode.content}`,
      );
      if (score > bestScore) {
        bestScore = score;
        bestPromptId = promptNode.id;
      }
    }

    mappings.push({
      canonicalNodeId: canonical.id,
      promptNodeId: bestScore >= 0.24 ? bestPromptId : undefined,
      sectionHeading: `${i + 1}. ${canonical.label}`,
    });
  }

  return mappings;
}

function similarityScore(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function tokenize(value: string): Set<string> {
  const matches = value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  return new Set(matches.filter((token) => !STOP_WORDS.has(token)));
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
