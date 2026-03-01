import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
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
}

interface CanonicalEdge {
  from: string;
  to: string;
  reason: string;
}

interface PromptNode {
  id: string;
  label: string;
  type: string;
  content: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'if', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'to', 'was', 'with', 'you',
]);

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
    const promptMarkdown = assemblePromptMarkdown(orderedNodes, flowData.edges, mode);

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
      promptMarkdown,
      nodeMappings: mappings,
      model: 'deterministic-flow-compiler',
      usedFallback: false,
      warning: null,
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
    .select('id, label, type, content')
    .eq('transcript_set_id', transcriptSetId);
  if (nodesRes.error) {
    throw new Error(`Failed to load canonical nodes: ${nodesRes.error.message}`);
  }

  const edgesRes = await admin
    .from('canonical_flow_edges')
    .select('from_node_id, to_node_id, reason')
    .eq('transcript_set_id', transcriptSetId);
  if (edgesRes.error) {
    throw new Error(`Failed to load canonical edges: ${edgesRes.error.message}`);
  }

  const nodes: CanonicalNode[] = (nodesRes.data ?? []).map((row) => ({
    id: row.id,
    label: normalizeText(row.label, 'Untitled step'),
    type: normalizeText(row.type, 'custom'),
    content: normalizeText(row.content, row.label || 'Step'),
  }));
  const edges: CanonicalEdge[] = (edgesRes.data ?? []).map((row) => ({
    from: row.from_node_id,
    to: row.to_node_id,
    reason: normalizeText(row.reason, 'Next'),
  }));

  if (nodes.length > 0) {
    return { nodes, edges };
  }

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
    return { nodes: [], edges: [] };
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
    return { nodes: [], edges: [] };
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
    });
  }
  return output;
}

function parseFallbackEdges(raw: unknown): CanonicalEdge[] {
  if (!Array.isArray(raw)) return [];
  const output: CanonicalEdge[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const from = normalizeText(item.from, '');
    const to = normalizeText(item.to, '');
    if (!from || !to) continue;
    output.push({
      from,
      to,
      reason: normalizeText(item.reason, 'Next'),
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

function assemblePromptMarkdown(
  nodes: CanonicalNode[],
  edges: CanonicalEdge[],
  mode: 'runtime' | 'flow-template',
): string {
  if (mode === 'runtime') {
    return nodes
      .map((node, index) => `## ${index + 1}. ${node.label}\n${node.content.trim() || '(empty node content)'}`)
      .join('\n\n');
  }

  const outgoingByNode = new Map<string, CanonicalEdge[]>();
  for (const edge of edges) {
    const bucket = outgoingByNode.get(edge.from) ?? [];
    bucket.push(edge);
    outgoingByNode.set(edge.from, bucket);
  }

  const sections = nodes.map((node, index) => {
    const sectionLines = [`## ${index + 1}. ${node.label}`];
    sectionLines.push(node.content.trim() || '(empty node content)');

    const outgoing = outgoingByNode.get(node.id) ?? [];
    if (outgoing.length === 0) {
      sectionLines.push('Next: [end]');
    } else if (outgoing.length === 1) {
      sectionLines.push(`Next: ${outgoing[0].to} [${outgoing[0].reason}]`);
    } else {
      sectionLines.push('Branches:');
      for (const edge of outgoing) {
        sectionLines.push(`- ${edge.to} [${edge.reason}]`);
      }
    }
    return sectionLines.join('\n');
  });

  return [
    '# Prompt Flow Template',
    'Generated from canonical transcript flow.',
    '',
    sections.join('\n\n'),
  ].join('\n');
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
