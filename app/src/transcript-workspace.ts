import type { NodeType } from './models';
import { supabase } from './supabase';
import type {
  TranscriptFlowConnection,
  TranscriptFlowNode,
  TranscriptFlowResult,
} from './transcript-flow';

export type WorkspaceNodePositionMap = Record<string, { x: number; y: number }>;

export interface TranscriptWorkspaceSnapshot {
  transcriptSetId: string;
  projectName: string;
  projectModel: string;
  flow: TranscriptFlowResult | null;
  nodePositionOverrides: WorkspaceNodePositionMap;
}

export interface UpsertTranscriptWorkspaceFlowRequest {
  transcriptSetId: string;
  flow: TranscriptFlowResult;
  projectName: string;
  nodePositionOverrides: WorkspaceNodePositionMap;
}

interface StoredTranscriptFlow {
  model: string;
  title: string;
  summary: string;
  usedFallback: boolean;
  warning: string | null;
  nodes: TranscriptFlowNode[];
  connections: TranscriptFlowConnection[];
}

interface CanonicalEdgeInsertRow {
  transcript_set_id: string;
  from_node_id: string;
  to_node_id: string;
  reason: string;
  support_count: number;
  transition_rate: number;
}

const DEFAULT_MODEL = 'GPT-4o';
const TRANSCRIPT_SET_SUFFIX_REGEX = /\s+transcript set$/i;
const WORKSPACE_EXTERNAL_ID_META_KEY = '__workspaceExternalId';
const VALID_NODE_TYPES = new Set<NodeType>([
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
]);

export async function loadTranscriptWorkspace(
  transcriptSetId: string,
): Promise<TranscriptWorkspaceSnapshot> {
  const normalizedSetId = transcriptSetId.trim();
  if (!normalizedSetId) {
    throw new Error('Transcript set id is required.');
  }

  const transcriptSetRes = await supabase
    .from('transcript_sets')
    .select('id, project_id, name, description')
    .eq('id', normalizedSetId)
    .maybeSingle();
  if (transcriptSetRes.error) {
    throw new Error(`Failed to load transcript workspace: ${transcriptSetRes.error.message}`);
  }
  if (!transcriptSetRes.data) {
    throw new Error('Transcript workspace not found.');
  }

  const transcriptSet = transcriptSetRes.data;
  const [canonicalNodes, canonicalEdges, latestFlow, linkedProjectModel] = await Promise.all([
    loadCanonicalNodes(normalizedSetId),
    loadCanonicalEdges(normalizedSetId),
    loadLatestStoredFlow(normalizedSetId),
    loadLinkedProjectModel(transcriptSet.project_id),
  ]);

  const projectName = stripTranscriptSetSuffix(transcriptSet.name);
  const nodePositionOverrides: WorkspaceNodePositionMap = {};

  if (canonicalNodes.length > 0) {
    const nodeIds = new Set<string>();
    const storageIdToFlowId = new Map<string, string>();
    const flowNodes: TranscriptFlowNode[] = canonicalNodes.map((node, index) => {
      const meta = toStringRecord(node.meta);
      const preferredFlowId = normalizeText(meta[WORKSPACE_EXTERNAL_ID_META_KEY], '') || node.id;
      const flowId = ensureUniqueId(preferredFlowId, nodeIds, `node_${index + 1}`);
      nodeIds.add(flowId);
      storageIdToFlowId.set(node.id, flowId);
      delete meta[WORKSPACE_EXTERNAL_ID_META_KEY];
      const position = readLayoutOverride(meta);
      if (position) {
        nodePositionOverrides[flowId] = position;
      }
      return {
        id: flowId,
        label: normalizeText(node.label, `Step ${index + 1}`),
        type: normalizeNodeType(node.type),
        icon: normalizeText(node.icon, 'widgets'),
        content: normalizeText(node.content, node.label || `Step ${index + 1}`),
        meta,
      };
    });

    const flowConnections: TranscriptFlowConnection[] = canonicalEdges
      .map((edge) => {
        const from = storageIdToFlowId.get(edge.from_node_id) ?? edge.from_node_id;
        const to = storageIdToFlowId.get(edge.to_node_id) ?? edge.to_node_id;
        if (!nodeIds.has(from) || !nodeIds.has(to)) {
          return null;
        }
        if (from === to) {
          return null;
        }
        const reason = normalizeText(edge.reason, 'Next');
        return {
          from,
          to,
          label: reason,
          reason,
          ...(Number.isFinite(edge.support_count) ? { supportCount: Math.max(0, Math.trunc(edge.support_count)) } : {}),
          ...(Number.isFinite(edge.transition_rate) ? { supportRate: clamp01(edge.transition_rate) } : {}),
        } as TranscriptFlowConnection;
      })
      .filter((item): item is TranscriptFlowConnection => item !== null);

    const flow: TranscriptFlowResult = {
      title: normalizeText(
        latestFlow?.title,
        projectName || 'Transcript Flow',
      ),
      summary: normalizeText(
        latestFlow?.summary,
        normalizeText(transcriptSet.description, 'Editable transcript flow workspace.'),
      ),
      model: normalizeText(
        latestFlow?.model,
        linkedProjectModel || DEFAULT_MODEL,
      ),
      nodes: flowNodes,
      connections: flowConnections,
      usedFallback: false,
      warning: null,
    };

    return {
      transcriptSetId: normalizedSetId,
      projectName,
      projectModel: flow.model,
      flow,
      nodePositionOverrides,
    };
  }

  if (latestFlow) {
    for (const node of latestFlow.nodes) {
      const position = readLayoutOverride(node.meta ?? {});
      if (position) {
        nodePositionOverrides[node.id] = position;
      }
    }
    return {
      transcriptSetId: normalizedSetId,
      projectName: projectName || latestFlow.title || 'Transcript Flow',
      projectModel: normalizeText(
        latestFlow.model,
        linkedProjectModel || DEFAULT_MODEL,
      ),
      flow: {
        title: normalizeText(latestFlow.title, projectName || 'Transcript Flow'),
        summary: normalizeText(
          latestFlow.summary,
          normalizeText(transcriptSet.description, 'Editable transcript flow workspace.'),
        ),
        model: normalizeText(latestFlow.model, linkedProjectModel || DEFAULT_MODEL),
        nodes: latestFlow.nodes,
        connections: latestFlow.connections,
        usedFallback: latestFlow.usedFallback,
        warning: latestFlow.warning,
      },
      nodePositionOverrides,
    };
  }

  return {
    transcriptSetId: normalizedSetId,
    projectName,
    projectModel: linkedProjectModel || DEFAULT_MODEL,
    flow: null,
    nodePositionOverrides: {},
  };
}

export async function upsertTranscriptWorkspaceFlow(
  request: UpsertTranscriptWorkspaceFlowRequest,
): Promise<void> {
  const transcriptSetId = request.transcriptSetId.trim();
  if (!transcriptSetId) {
    throw new Error('Transcript set id is required for workspace save.');
  }

  const externalNodeIds = new Set<string>();
  const storageNodeIds = new Set<string>();
  const storageIdByExternalId = new Map<string, string>();
  const nodeRows = request.flow.nodes.map((node, index) => {
    const externalId = node.id.trim();
    if (!externalId) {
      throw new Error(`Flow node at index ${index} is missing an id.`);
    }
    if (externalNodeIds.has(externalId)) {
      throw new Error(`Duplicate flow node id "${externalId}" in workspace save payload.`);
    }
    externalNodeIds.add(externalId);

    const storageId = buildScopedCanonicalNodeId(transcriptSetId, externalId);
    if (storageNodeIds.has(storageId)) {
      throw new Error(`Duplicate scoped node id "${storageId}" in workspace save payload.`);
    }
    storageNodeIds.add(storageId);
    storageIdByExternalId.set(externalId, storageId);

    const mergedMeta = mergeNodeMetaWithLayout(
      node.meta ?? {},
      request.nodePositionOverrides[externalId] ?? null,
    );
    mergedMeta[WORKSPACE_EXTERNAL_ID_META_KEY] = externalId;
    return {
      id: storageId,
      transcript_set_id: transcriptSetId,
      label: normalizeText(node.label, `Step ${index + 1}`),
      type: normalizeNodeType(node.type),
      icon: normalizeText(node.icon, 'widgets'),
      content: normalizeText(node.content, node.label || `Step ${index + 1}`),
      meta: mergedMeta as Record<string, unknown>,
      support_count: parseNodeSupportCount(mergedMeta),
      confidence: parseNodeConfidence(mergedMeta),
    };
  });

  const edgeRows = buildCanonicalEdgeRows({
    transcriptSetId,
    connections: request.flow.connections,
    externalNodeIds,
    storageIdByExternalId,
  });

  const deleteNodesRes = await supabase
    .from('canonical_flow_nodes')
    .delete()
    .eq('transcript_set_id', transcriptSetId);
  if (deleteNodesRes.error) {
    throw new Error(`Failed to clear prior workspace nodes: ${deleteNodesRes.error.message}`);
  }

  if (nodeRows.length > 0) {
    const insertNodesRes = await supabase
      .from('canonical_flow_nodes')
      .insert(nodeRows);
    if (insertNodesRes.error) {
      throw new Error(`Failed to save workspace nodes: ${insertNodesRes.error.message}`);
    }
  }

  if (edgeRows.length > 0) {
    const insertEdgesRes = await supabase
      .from('canonical_flow_edges')
      .insert(edgeRows);
    if (insertEdgesRes.error) {
      throw new Error(`Failed to save workspace edges: ${insertEdgesRes.error.message}`);
    }
  }

  const updateSetRes = await supabase
    .from('transcript_sets')
    .update({
      name: buildTranscriptSetName(request.projectName || request.flow.title),
      description: normalizeText(request.flow.summary, 'Editable transcript flow workspace.'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transcriptSetId);
  if (updateSetRes.error) {
    throw new Error(`Failed to update transcript workspace metadata: ${updateSetRes.error.message}`);
  }
}

async function loadCanonicalNodes(transcriptSetId: string): Promise<Array<{
  id: string;
  label: string;
  type: string;
  icon: string;
  content: string;
  meta: Record<string, unknown>;
}>> {
  const res = await supabase
    .from('canonical_flow_nodes')
    .select('id, label, type, icon, content, meta')
    .eq('transcript_set_id', transcriptSetId);
  if (res.error) {
    throw new Error(`Failed to load canonical nodes: ${res.error.message}`);
  }
  return res.data ?? [];
}

async function loadCanonicalEdges(transcriptSetId: string): Promise<Array<{
  from_node_id: string;
  to_node_id: string;
  reason: string;
  support_count: number;
  transition_rate: number;
}>> {
  const res = await supabase
    .from('canonical_flow_edges')
    .select('from_node_id, to_node_id, reason, support_count, transition_rate')
    .eq('transcript_set_id', transcriptSetId);
  if (res.error) {
    throw new Error(`Failed to load canonical edges: ${res.error.message}`);
  }
  return (res.data ?? []).map((row) => ({
    from_node_id: row.from_node_id,
    to_node_id: row.to_node_id,
    reason: normalizeText(row.reason, ''),
    support_count: typeof row.support_count === 'number' ? row.support_count : 0,
    transition_rate: typeof row.transition_rate === 'number' ? row.transition_rate : 0,
  }));
}

async function loadLinkedProjectModel(projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const res = await supabase
    .from('projects')
    .select('model')
    .eq('id', projectId)
    .maybeSingle();
  if (res.error) {
    return null;
  }
  return normalizeText(res.data?.model, '') || null;
}

async function loadLatestStoredFlow(
  transcriptSetId: string,
): Promise<StoredTranscriptFlow | null> {
  const transcriptsRes = await supabase
    .from('transcripts')
    .select('id')
    .eq('transcript_set_id', transcriptSetId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (transcriptsRes.error) {
    throw new Error(`Failed to load transcripts for workspace: ${transcriptsRes.error.message}`);
  }

  const transcriptIds = (transcriptsRes.data ?? []).map((row) => row.id);
  if (transcriptIds.length === 0) {
    return null;
  }

  const flowRes = await supabase
    .from('transcript_flows')
    .select('model, flow_title, flow_summary, nodes_json, connections_json, used_fallback, warning')
    .in('transcript_id', transcriptIds)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (flowRes.error) {
    throw new Error(`Failed to load latest transcript flow: ${flowRes.error.message}`);
  }
  if (!flowRes.data) {
    return null;
  }

  return {
    model: normalizeText(flowRes.data.model, DEFAULT_MODEL),
    title: normalizeText(flowRes.data.flow_title, 'Transcript Flow'),
    summary: normalizeText(flowRes.data.flow_summary, 'Generated flow from transcript artifacts.'),
    usedFallback: flowRes.data.used_fallback === true,
    warning: normalizeText(flowRes.data.warning, '') || null,
    nodes: parseStoredFlowNodes(flowRes.data.nodes_json),
    connections: parseStoredFlowConnections(flowRes.data.connections_json),
  };
}

function parseStoredFlowNodes(raw: unknown): TranscriptFlowNode[] {
  if (!Array.isArray(raw)) return [];

  const usedIds = new Set<string>();
  const nodes: TranscriptFlowNode[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const node = raw[index];
    if (!isRecord(node)) continue;
    const rawId = normalizeText(node.id, `node_${index + 1}`).replace(/\s+/g, '_').toLowerCase();
    const id = ensureUniqueId(rawId, usedIds, `node_${index + 1}`);
    usedIds.add(id);

    nodes.push({
      id,
      label: normalizeText(node.label, `Step ${index + 1}`),
      type: normalizeNodeType(node.type),
      icon: normalizeText(node.icon, 'widgets'),
      content: normalizeText(node.content, normalizeText(node.label, `Step ${index + 1}`)),
      meta: toStringRecord(node.meta),
    });
  }
  return nodes;
}

function parseStoredFlowConnections(raw: unknown): TranscriptFlowConnection[] {
  if (!Array.isArray(raw)) return [];

  const connections: TranscriptFlowConnection[] = [];
  const dedupe = new Set<string>();
  for (const candidate of raw) {
    if (!isRecord(candidate)) continue;
    const from = normalizeText(candidate.from, '');
    const to = normalizeText(candidate.to, '');
    if (!from || !to || from === to) continue;
    const reason = normalizeText(candidate.reason, 'Next');
    const isInferred = typeof candidate.isInferred === 'boolean' ? candidate.isInferred : null;
    const inferenceTypeRaw = typeof candidate.inferenceType === 'string'
      ? candidate.inferenceType.trim().toLowerCase()
      : '';
    const inferenceType = inferenceTypeRaw.length > 0
      ? inferenceTypeRaw
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
      : '';
    const key = `${from}->${to}->${reason.toLowerCase()}->${inferenceType}->${isInferred === true ? '1' : isInferred === false ? '0' : ''}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    const supportCount = parseFiniteInt(candidate.supportCount);
    const supportRate = parseFiniteNumber(candidate.supportRate);
    connections.push({
      from,
      to,
      reason,
      ...(isInferred !== null ? { isInferred } : {}),
      ...(inferenceType.length > 0 ? { inferenceType } : {}),
      ...(supportCount !== null ? { supportCount: Math.max(0, supportCount) } : {}),
      ...(supportRate !== null ? { supportRate: clamp01(supportRate) } : {}),
    });
  }

  return connections;
}

function buildCanonicalEdgeRows(args: {
  transcriptSetId: string;
  connections: TranscriptFlowConnection[];
  externalNodeIds: ReadonlySet<string>;
  storageIdByExternalId: ReadonlyMap<string, string>;
}): CanonicalEdgeInsertRow[] {
  const buckets = new Map<string, {
    row: CanonicalEdgeInsertRow;
    reasons: string[];
    reasonSet: Set<string>;
  }>();

  for (const connection of args.connections) {
    const from = connection.from.trim();
    const to = connection.to.trim();
    if (!from || !to) continue;
    if (!args.externalNodeIds.has(from) || !args.externalNodeIds.has(to)) continue;
    if (from === to) continue;
    const fromStorageId = args.storageIdByExternalId.get(from);
    const toStorageId = args.storageIdByExternalId.get(to);
    if (!fromStorageId || !toStorageId) continue;

    const reason = normalizeText(connection.reason, 'Next');
    const supportCount = typeof connection.supportCount === 'number' && Number.isFinite(connection.supportCount)
      ? Math.max(0, Math.trunc(connection.supportCount))
      : 0;
    const transitionRate = typeof connection.supportRate === 'number' && Number.isFinite(connection.supportRate)
      ? clamp01(connection.supportRate)
      : 0;

    const key = `${fromStorageId}->${toStorageId}`;
    const bucket = buckets.get(key);
    if (!bucket) {
      const reasonSet = new Set<string>();
      const reasons: string[] = [];
      const normalizedReasonKey = normalizeReasonKey(reason);
      if (normalizedReasonKey.length > 0) {
        reasonSet.add(normalizedReasonKey);
        reasons.push(reason);
      }
      buckets.set(key, {
        row: {
          transcript_set_id: args.transcriptSetId,
          from_node_id: fromStorageId,
          to_node_id: toStorageId,
          reason,
          support_count: supportCount,
          transition_rate: transitionRate,
        },
        reasons,
        reasonSet,
      });
      continue;
    }

    bucket.row.support_count = Math.max(bucket.row.support_count, supportCount);
    bucket.row.transition_rate = Math.max(bucket.row.transition_rate, transitionRate);

    const normalizedReasonKey = normalizeReasonKey(reason);
    if (normalizedReasonKey.length > 0 && !bucket.reasonSet.has(normalizedReasonKey)) {
      bucket.reasonSet.add(normalizedReasonKey);
      bucket.reasons.push(reason);
    }
    bucket.row.reason = resolveMergedEdgeReason(bucket.reasons);
  }

  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket.row,
    reason: resolveMergedEdgeReason(bucket.reasons),
  }));
}

function resolveMergedEdgeReason(reasons: string[]): string {
  const unique = Array.from(new Set(
    reasons
      .map((reason) => reason.trim())
      .filter((reason) => reason.length > 0),
  ));
  if (unique.length === 0) return 'Next';

  const nonGeneric = unique.filter((reason) => !isGenericEdgeReason(reason));
  const selected = nonGeneric.length > 0 ? nonGeneric : unique;
  if (selected.length === 1) return selected[0];

  return selected.slice(0, 3).join(' / ');
}

function isGenericEdgeReason(reason: string): boolean {
  const normalized = normalizeReasonKey(reason);
  return normalized === 'next'
    || normalized === 'proceed'
    || normalized === 'continue'
    || normalized === 'after'
    || normalized === 'step';
}

function normalizeReasonKey(reason: string): string {
  return reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeNodeMetaWithLayout(
  meta: Record<string, string>,
  position: { x: number; y: number } | null,
): Record<string, string> {
  const merged = { ...meta };
  if (!position) return merged;
  merged.layoutX = String(Math.round(position.x));
  merged.layoutY = String(Math.round(position.y));
  return merged;
}

function readLayoutOverride(meta: Record<string, string>): { x: number; y: number } | null {
  const x = parseFiniteNumber(meta.layoutX ?? meta.x);
  const y = parseFiniteNumber(meta.layoutY ?? meta.y);
  if (x === null || y === null) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function parseNodeSupportCount(meta: Record<string, string>): number {
  const ratio = meta.callSupport;
  if (!ratio) return 0;
  const match = ratio.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return 0;
  return Math.max(0, Number.parseInt(match[1], 10) || 0);
}

function parseNodeConfidence(meta: Record<string, string>): number {
  const percent = meta.callSupportPercent;
  if (!percent) return 0;
  const parsed = Number.parseFloat(percent.replace('%', '').trim());
  if (!Number.isFinite(parsed)) return 0;
  return clamp01(parsed / 100);
}

function normalizeNodeType(value: unknown): NodeType {
  if (typeof value !== 'string') return 'custom';
  const normalized = value.trim().toLowerCase();
  if (VALID_NODE_TYPES.has(normalized as NodeType)) {
    return normalized as NodeType;
  }
  return 'custom';
}

function buildTranscriptSetName(projectName: string): string {
  const normalized = projectName.trim();
  if (!normalized) return 'Transcript Set';
  return `${normalized} Transcript Set`;
}

function stripTranscriptSetSuffix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.replace(TRANSCRIPT_SET_SUFFIX_REGEX, '').trim() || trimmed;
}

function buildScopedCanonicalNodeId(transcriptSetId: string, nodeId: string): string {
  return `${transcriptSetId.trim()}::${nodeId.trim()}`;
}

function ensureUniqueId(baseId: string, used: Set<string>, fallback: string): string {
  const base = baseId.trim() || fallback;
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim();
    if (normalized.length > 0) {
      output[key] = normalized;
    }
  }
  return output;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFiniteInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const transcriptWorkspaceTestUtils = {
  stripTranscriptSetSuffix,
  buildTranscriptSetName,
  buildScopedCanonicalNodeId,
  readLayoutOverride,
  mergeNodeMetaWithLayout,
  parseNodeSupportCount,
  parseNodeConfidence,
  buildCanonicalEdgeRows,
};
