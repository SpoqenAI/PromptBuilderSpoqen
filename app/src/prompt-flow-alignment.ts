import type { PromptNode } from './models';
import { supabase } from './supabase';

export type PromptCoverageStatus = 'covered' | 'uncovered' | 'overconstrained';

export interface TranscriptSetOption {
  id: string;
  name: string;
  projectId: string | null;
  createdAt: string;
}

export interface PromptFlowCoverageItem {
  promptNodeId: string;
  promptLabel: string;
  promptType: string;
  status: PromptCoverageStatus;
  confidence: number;
  reason: string;
  canonicalNodeId: string | null;
  canonicalLabel: string | null;
}

export interface PromptFlowAlignmentResult {
  transcriptSetId: string;
  promptNodeCount: number;
  canonicalNodeCount: number;
  coveredCount: number;
  uncoveredCount: number;
  overconstrainedCount: number;
  persistedCount: number;
  items: PromptFlowCoverageItem[];
}

export interface RunPromptFlowAlignmentArgs {
  projectId: string;
  transcriptSetId: string;
  persist?: boolean;
}

interface PromptNodeRecord {
  id: string;
  type: string;
  label: string;
  content: string;
}

interface CanonicalNodeRecord {
  id: string;
  label: string;
  type: string;
  content: string;
  supportCount: number;
}

interface FlowNodeLike {
  id: string;
  label: string;
  type: string;
  icon: string;
  content: string;
  meta: Record<string, string>;
}

interface FlowConnectionLike {
  from: string;
  to: string;
  reason: string;
}

interface CandidateScore {
  canonicalNode: CanonicalNodeRecord;
  score: number;
  tokenScore: number;
  labelScore: number;
  typeScore: number;
  supportScore: number;
}

interface CanonicalNodeDraft {
  id: string;
  label: string;
  type: string;
  icon: string;
  content: string;
  supportCount: number;
  confidence: number;
}

interface CanonicalEdgeDraft {
  fromNodeId: string;
  toNodeId: string;
  reason: string;
  supportCount: number;
  transitionRate: number;
}

const COVERED_SCORE_THRESHOLD = 0.58;
const OVERCONSTRAINED_SCORE_THRESHOLD = 0.35;
const PERSIST_SCORE_THRESHOLD = 0.35;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'have', 'i', 'if', 'in', 'into', 'is', 'it', 'of', 'on', 'or',
  'our', 'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this',
  'to', 'was', 'we', 'with', 'you', 'your',
]);

export async function listTranscriptSetsForAlignment(projectId: string): Promise<TranscriptSetOption[]> {
  const res = await supabase
    .from('transcript_sets')
    .select('id, name, project_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (res.error) {
    throw new Error(`Failed to load transcript sets: ${res.error.message}`);
  }

  const options: TranscriptSetOption[] = (res.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    createdAt: row.created_at,
  }));

  return options.sort((left, right) => {
    const leftLinked = left.projectId === projectId ? 1 : 0;
    const rightLinked = right.projectId === projectId ? 1 : 0;
    if (leftLinked !== rightLinked) return rightLinked - leftLinked;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export async function runPromptFlowAlignment(args: RunPromptFlowAlignmentArgs): Promise<PromptFlowAlignmentResult> {
  const promptNodes = await loadPromptNodes(args.projectId);
  const canonicalNodes = await ensureCanonicalNodes(args.transcriptSetId);

  const bestByPromptNode = new Map<string, CandidateScore | null>();
  for (const promptNode of promptNodes) {
    bestByPromptNode.set(promptNode.id, selectBestCandidate(promptNode, canonicalNodes));
  }

  const items = promptNodes.map((promptNode): PromptFlowCoverageItem => {
    const best = bestByPromptNode.get(promptNode.id);
    if (!best || best.score < OVERCONSTRAINED_SCORE_THRESHOLD) {
      return {
        promptNodeId: promptNode.id,
        promptLabel: promptNode.label,
        promptType: promptNode.type,
        status: 'uncovered',
        confidence: best?.score ?? 0,
        reason: best
          ? `Weak match (${percent(best.score)}) to "${best.canonicalNode.label}".`
          : 'No canonical node candidates available.',
        canonicalNodeId: best?.canonicalNode.id ?? null,
        canonicalLabel: best?.canonicalNode.label ?? null,
      };
    }

    const status: PromptCoverageStatus = best.score >= COVERED_SCORE_THRESHOLD
      ? 'covered'
      : 'overconstrained';

    return {
      promptNodeId: promptNode.id,
      promptLabel: promptNode.label,
      promptType: promptNode.type,
      status,
      confidence: best.score,
      reason: buildReason(best),
      canonicalNodeId: best.canonicalNode.id,
      canonicalLabel: best.canonicalNode.label,
    };
  });

  applyCanonicalCollisionRule(items);

  const persistedCount = args.persist === false
    ? 0
    : await persistAlignments(args.projectId, args.transcriptSetId, items);

  const coveredCount = items.filter((item) => item.status === 'covered').length;
  const uncoveredCount = items.filter((item) => item.status === 'uncovered').length;
  const overconstrainedCount = items.filter((item) => item.status === 'overconstrained').length;

  return {
    transcriptSetId: args.transcriptSetId,
    promptNodeCount: promptNodes.length,
    canonicalNodeCount: canonicalNodes.length,
    coveredCount,
    uncoveredCount,
    overconstrainedCount,
    persistedCount,
    items: items.sort(compareCoverageItems),
  };
}

async function loadPromptNodes(projectId: string): Promise<PromptNodeRecord[]> {
  const res = await supabase
    .from('prompt_nodes')
    .select('id, type, label, content, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (res.error) {
    throw new Error(`Failed to load prompt nodes: ${res.error.message}`);
  }

  return (res.data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    label: normalizeLabel(row.label),
    content: row.content,
  }));
}

async function ensureCanonicalNodes(transcriptSetId: string): Promise<CanonicalNodeRecord[]> {
  const existing = await loadCanonicalNodes(transcriptSetId);
  if (existing.length > 0) {
    return existing;
  }

  const rebuilt = await rebuildCanonicalFlowFromTranscripts(transcriptSetId);
  if (rebuilt.nodes.length === 0) {
    return [];
  }
  return loadCanonicalNodes(transcriptSetId);
}

async function loadCanonicalNodes(transcriptSetId: string): Promise<CanonicalNodeRecord[]> {
  const res = await supabase
    .from('canonical_flow_nodes')
    .select('id, label, type, content, support_count')
    .eq('transcript_set_id', transcriptSetId);
  if (res.error) {
    throw new Error(`Failed to load canonical flow nodes: ${res.error.message}`);
  }

  return (res.data ?? []).map((row) => ({
    id: row.id,
    label: normalizeLabel(row.label),
    type: row.type,
    content: row.content,
    supportCount: Math.max(0, row.support_count ?? 0),
  }));
}

function selectBestCandidate(promptNode: PromptNodeRecord, canonicalNodes: CanonicalNodeRecord[]): CandidateScore | null {
  if (canonicalNodes.length === 0) return null;

  let best: CandidateScore | null = null;
  for (const canonicalNode of canonicalNodes) {
    const tokenScore = jaccardSimilarity(tokensForNode(promptNode), tokensForNode(canonicalNode));
    const labelScore = stringSimilarity(promptNode.label, canonicalNode.label);
    const typeScore = typeCompatibility(promptNode.type, canonicalNode.type);
    const supportScore = Math.min(Math.log2(canonicalNode.supportCount + 1) / 4, 1);
    const score = clamp01(
      tokenScore * 0.56 +
      labelScore * 0.22 +
      typeScore * 0.17 +
      supportScore * 0.05,
    );

    const candidate: CandidateScore = {
      canonicalNode,
      score,
      tokenScore,
      labelScore,
      typeScore,
      supportScore,
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

function buildReason(best: CandidateScore): string {
  return [
    `Matched "${best.canonicalNode.label}"`,
    `confidence ${percent(best.score)}`,
    `token overlap ${percent(best.tokenScore)}`,
    `label similarity ${percent(best.labelScore)}`,
    `type compatibility ${percent(best.typeScore)}`,
  ].join(' | ');
}

function applyCanonicalCollisionRule(items: PromptFlowCoverageItem[]): void {
  const byCanonical = new Map<string, PromptFlowCoverageItem[]>();
  for (const item of items) {
    if (!item.canonicalNodeId) continue;
    if (item.status === 'uncovered') continue;
    const group = byCanonical.get(item.canonicalNodeId) ?? [];
    group.push(item);
    byCanonical.set(item.canonicalNodeId, group);
  }

  for (const group of byCanonical.values()) {
    if (group.length < 2) continue;
    group.sort((left, right) => right.confidence - left.confidence);
    for (let index = 1; index < group.length; index += 1) {
      const item = group[index];
      item.status = 'overconstrained';
      item.reason = `${item.reason} | Multiple prompt sections map to the same canonical step.`;
    }
  }
}

async function persistAlignments(
  projectId: string,
  transcriptSetId: string,
  items: PromptFlowCoverageItem[],
): Promise<number> {
  const deleteRes = await supabase
    .from('prompt_flow_alignments')
    .delete()
    .eq('project_id', projectId)
    .eq('transcript_set_id', transcriptSetId);
  if (deleteRes.error) {
    throw new Error(`Failed to clear prior prompt alignments: ${deleteRes.error.message}`);
  }

  const rows = items
    .filter((item) => item.canonicalNodeId !== null && item.confidence >= PERSIST_SCORE_THRESHOLD)
    .map((item) => ({
      transcript_set_id: transcriptSetId,
      project_id: projectId,
      prompt_node_id: item.promptNodeId,
      canonical_node_id: item.canonicalNodeId as string,
      alignment_score: item.confidence,
      alignment_reason: item.reason,
    }));

  if (rows.length === 0) {
    return 0;
  }

  const insertRes = await supabase.from('prompt_flow_alignments').insert(rows);
  if (insertRes.error) {
    throw new Error(`Failed to persist prompt alignments: ${insertRes.error.message}`);
  }

  return rows.length;
}

async function rebuildCanonicalFlowFromTranscripts(
  transcriptSetId: string,
): Promise<{ nodes: CanonicalNodeDraft[]; edges: CanonicalEdgeDraft[] }> {
  const transcriptsRes = await supabase
    .from('transcripts')
    .select('id')
    .eq('transcript_set_id', transcriptSetId);
  if (transcriptsRes.error) {
    throw new Error(`Failed to load transcripts for canonical flow: ${transcriptsRes.error.message}`);
  }

  const transcriptIds = (transcriptsRes.data ?? []).map((row) => row.id);
  if (transcriptIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  const flowsRes = await supabase
    .from('transcript_flows')
    .select('id, nodes_json, connections_json')
    .in('transcript_id', transcriptIds);
  if (flowsRes.error) {
    throw new Error(`Failed to load transcript flows for canonical flow: ${flowsRes.error.message}`);
  }

  const totalFlows = Math.max(1, (flowsRes.data ?? []).length);
  const nodeBuckets = new Map<string, {
    id: string;
    type: string;
    icon: string;
    labelVotes: Map<string, number>;
    contentVotes: Map<string, number>;
    supportFlows: Set<string>;
  }>();
  const edgeBuckets = new Map<string, {
    fromNodeId: string;
    toNodeId: string;
    reasonVotes: Map<string, number>;
    supportCount: number;
  }>();

  for (const flowRow of flowsRes.data ?? []) {
    const flowNodes = parseFlowNodes(flowRow.nodes_json);
    const flowConnections = parseFlowConnections(flowRow.connections_json);
    const nodeIdToCanonical = new Map<string, string>();

    for (const node of flowNodes) {
      const key = nodeBucketKey(node);
      const canonicalId = canonicalIdFromKey(key);
      nodeIdToCanonical.set(node.id, canonicalId);
      const bucket = nodeBuckets.get(canonicalId) ?? {
        id: canonicalId,
        type: node.type,
        icon: node.icon || 'widgets',
        labelVotes: new Map<string, number>(),
        contentVotes: new Map<string, number>(),
        supportFlows: new Set<string>(),
      };
      bucket.type = bucket.type || node.type;
      bucket.icon = bucket.icon || node.icon || 'widgets';
      bumpVote(bucket.labelVotes, normalizeLabel(node.label));
      bumpVote(bucket.contentVotes, node.content.trim() || normalizeLabel(node.label));
      bucket.supportFlows.add(flowRow.id);
      nodeBuckets.set(canonicalId, bucket);
    }

    for (const connection of flowConnections) {
      const fromCanonicalId = nodeIdToCanonical.get(connection.from);
      const toCanonicalId = nodeIdToCanonical.get(connection.to);
      if (!fromCanonicalId || !toCanonicalId) continue;
      if (fromCanonicalId === toCanonicalId) continue;

      const edgeKey = `${fromCanonicalId}->${toCanonicalId}`;
      const bucket = edgeBuckets.get(edgeKey) ?? {
        fromNodeId: fromCanonicalId,
        toNodeId: toCanonicalId,
        reasonVotes: new Map<string, number>(),
        supportCount: 0,
      };
      bucket.supportCount += 1;
      if (connection.reason.trim().length > 0) {
        bumpVote(bucket.reasonVotes, connection.reason.trim());
      }
      edgeBuckets.set(edgeKey, bucket);
    }
  }

  const nodes: CanonicalNodeDraft[] = Array.from(nodeBuckets.values()).map((bucket) => ({
    id: bucket.id,
    label: topVote(bucket.labelVotes) || 'N/A',
    type: bucket.type || 'custom',
    icon: bucket.icon || 'widgets',
    content: topVote(bucket.contentVotes) || '',
    supportCount: bucket.supportFlows.size,
    confidence: clamp01(bucket.supportFlows.size / totalFlows),
  }));

  const edges: CanonicalEdgeDraft[] = Array.from(edgeBuckets.values()).map((bucket) => ({
    fromNodeId: bucket.fromNodeId,
    toNodeId: bucket.toNodeId,
    reason: topVote(bucket.reasonVotes) || '',
    supportCount: bucket.supportCount,
    transitionRate: clamp01(bucket.supportCount / totalFlows),
  }));

  const deleteRes = await supabase
    .from('canonical_flow_nodes')
    .delete()
    .eq('transcript_set_id', transcriptSetId);
  if (deleteRes.error) {
    throw new Error(`Failed to clear canonical flow nodes: ${deleteRes.error.message}`);
  }

  if (nodes.length > 0) {
    const insertNodesRes = await supabase.from('canonical_flow_nodes').insert(
      nodes.map((node) => ({
        id: node.id,
        transcript_set_id: transcriptSetId,
        label: node.label,
        type: node.type,
        icon: node.icon,
        content: node.content,
        support_count: node.supportCount,
        confidence: node.confidence,
        meta: { generatedBy: 'prompt-flow-alignment' },
      })),
    );
    if (insertNodesRes.error) {
      throw new Error(`Failed to store canonical flow nodes: ${insertNodesRes.error.message}`);
    }
  }

  if (edges.length > 0) {
    const insertEdgesRes = await supabase.from('canonical_flow_edges').insert(
      edges.map((edge) => ({
        transcript_set_id: transcriptSetId,
        from_node_id: edge.fromNodeId,
        to_node_id: edge.toNodeId,
        reason: edge.reason,
        support_count: edge.supportCount,
        transition_rate: edge.transitionRate,
      })),
    );
    if (insertEdgesRes.error) {
      throw new Error(`Failed to store canonical flow edges: ${insertEdgesRes.error.message}`);
    }
  }

  return { nodes, edges };
}

function parseFlowNodes(raw: unknown): FlowNodeLike[] {
  if (!Array.isArray(raw)) return [];
  const nodes: FlowNodeLike[] = [];
  for (const value of raw) {
    if (!isRecord(value)) continue;
    const id = readText(value.id);
    const label = normalizeLabel(readText(value.label));
    if (!id || !label) continue;
    nodes.push({
      id,
      label,
      type: readText(value.type) || 'custom',
      icon: readText(value.icon) || 'widgets',
      content: readText(value.content) || label,
      meta: {},
    });
  }
  return nodes;
}

function parseFlowConnections(raw: unknown): FlowConnectionLike[] {
  if (!Array.isArray(raw)) return [];
  const connections: FlowConnectionLike[] = [];
  for (const value of raw) {
    if (!isRecord(value)) continue;
    const from = readText(value.from);
    const to = readText(value.to);
    if (!from || !to) continue;
    connections.push({
      from,
      to,
      reason: readText(value.reason),
    });
  }
  return connections;
}

function nodeBucketKey(node: Pick<FlowNodeLike, 'type' | 'label'>): string {
  return `${normalizeLabel(node.type)}|${normalizeLabel(node.label)}`;
}

function canonicalIdFromKey(key: string): string {
  return `canon_${hashText(key)}`;
}

function tokensForNode(node: Pick<PromptNodeRecord | CanonicalNodeRecord | PromptNode, 'label' | 'content'>): string[] {
  const combined = `${node.label} ${node.content}`.toLowerCase();
  const matches = combined.match(/[a-z0-9]{2,}/g) ?? [];
  return matches.filter((token) => !STOP_WORDS.has(token));
}

function jaccardSimilarity(leftTokens: string[], rightTokens: string[]): number {
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  if (union === 0) return 0;
  return clamp01(intersection / union);
}

function stringSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeLabel(left);
  const normalizedRight = normalizeLabel(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.7;

  const leftSet = new Set(normalizedLeft.split(' '));
  const rightSet = new Set(normalizedRight.split(' '));
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) overlap += 1;
  }
  const denom = Math.max(leftSet.size, rightSet.size);
  if (denom === 0) return 0;
  return clamp01(overlap / denom);
}

function typeCompatibility(promptType: string, canonicalType: string): number {
  const left = normalizeLabel(promptType);
  const right = normalizeLabel(canonicalType);
  if (left === right) return 1;
  if (typeFamily(left) === typeFamily(right)) return 0.65;
  return 0.15;
}

function typeFamily(type: string): string {
  switch (type) {
    case 'core persona':
    case 'mission objective':
    case 'tone guidelines':
    case 'language model':
    case 'style module':
      return 'prompt-definition';
    case 'logic branch':
      return 'flow-control';
    case 'termination':
      return 'flow-end';
    case 'llm brain':
    case 'transcriber':
    case 'voice synth':
      return 'model-runtime';
    case 'memory buffer':
    case 'static context':
    case 'vector db':
      return 'knowledge';
    case 'webhook':
      return 'integration';
    default:
      return 'custom';
  }
}

function compareCoverageItems(left: PromptFlowCoverageItem, right: PromptFlowCoverageItem): number {
  const priority = (status: PromptCoverageStatus): number => {
    switch (status) {
      case 'uncovered':
        return 0;
      case 'overconstrained':
        return 1;
      case 'covered':
        return 2;
      default:
        return 3;
    }
  };

  const statusDelta = priority(left.status) - priority(right.status);
  if (statusDelta !== 0) return statusDelta;
  if (left.status !== 'covered' || right.status !== 'covered') {
    return left.promptLabel.localeCompare(right.promptLabel);
  }
  return right.confidence - left.confidence;
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function readText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function percent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function bumpVote(votes: Map<string, number>, value: string): void {
  if (!value) return;
  votes.set(value, (votes.get(value) ?? 0) + 1);
}

function topVote(votes: Map<string, number>): string {
  let winner = '';
  let winnerCount = -1;
  for (const [value, count] of votes.entries()) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }
  return winner;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
