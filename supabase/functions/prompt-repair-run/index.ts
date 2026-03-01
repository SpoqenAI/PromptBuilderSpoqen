import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { generateStructuredJson, resolveDefaultGroqModel, resolveDefaultOpenAiModel } from '../_shared/llm-provider.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';

interface RequestBody {
  projectId?: unknown;
  transcriptSetId?: unknown;
  objective?: unknown;
  applyMode?: unknown;
}

interface PromptNodeRecord {
  id: string;
  label: string;
  type: string;
  content: string;
}

interface CanonicalNodeRecord {
  id: string;
  label: string;
  type: string;
  content: string;
  supportCount: number;
}

interface RepairPatchDraft {
  patchId: string;
  promptNodeId: string;
  oldContent: string;
  newContent: string;
  rationale: string;
  evidence: string[];
  confidence: number;
}

interface Candidate {
  canonical: CanonicalNodeRecord | null;
  score: number;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'have', 'if', 'in', 'is', 'it', 'of', 'on', 'or',
  'that', 'the', 'to', 'was', 'with', 'you',
]);

const REPAIR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['newContent', 'rationale', 'confidence', 'evidence'],
  properties: {
    newContent: { type: 'string' },
    rationale: { type: 'string' },
    confidence: { type: 'number' },
    evidence: {
      type: 'array',
      items: { type: 'string' },
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
    const body = await parseJson<RequestBody>(req);
    const projectId = normalizeRequiredId(body.projectId, 'projectId');
    const transcriptSetId = normalizeRequiredId(body.transcriptSetId, 'transcriptSetId');
    const objective = normalizeObjective(body.objective);
    const applyMode = normalizeApplyMode(body.applyMode);

    if (applyMode !== 'manual') {
      throw new Error('Only manual apply mode is supported.');
    }

    const admin = createAdminClient();
    const user = await requireUser(req, admin);
    await assertOwnership(admin, user.id, projectId, transcriptSetId);

    const promptNodes = await loadPromptNodes(admin, projectId);
    const canonicalNodes = await loadCanonicalNodes(admin, transcriptSetId);

    if (promptNodes.length === 0) {
      throw new Error('No prompt nodes found for this project.');
    }
    if (canonicalNodes.length === 0) {
      throw new Error('No canonical flow nodes found for this transcript set.');
    }

    const runInsert = await admin
      .from('optimization_runs')
      .insert({
        transcript_set_id: transcriptSetId,
        project_id: projectId,
        status: 'running',
        objective,
        input_snapshot: {
          promptNodeCount: promptNodes.length,
          canonicalNodeCount: canonicalNodes.length,
          applyMode,
        },
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (runInsert.error || !runInsert.data?.id) {
      throw new Error(runInsert.error?.message ?? 'Failed to create optimization run.');
    }
    const runId = runInsert.data.id;

    const bestByPrompt = new Map<string, Candidate>();
    for (const promptNode of promptNodes) {
      bestByPrompt.set(promptNode.id, findBestCandidate(promptNode, canonicalNodes));
    }

    const deviations = promptNodes.filter((node) => {
      const candidate = bestByPrompt.get(node.id);
      return !candidate || candidate.score < 0.58;
    });

    const limitedDeviations = deviations.slice(0, 24);
    const patches: RepairPatchDraft[] = [];
    for (const node of limitedDeviations) {
      const candidate = bestByPrompt.get(node.id) ?? { canonical: null, score: 0 };
      const patch = await proposeRepairPatch(node, candidate, objective);
      patches.push({
        patchId: crypto.randomUUID(),
        promptNodeId: node.id,
        oldContent: node.content,
        newContent: patch.newContent,
        rationale: patch.rationale,
        evidence: patch.evidence,
        confidence: clamp01(patch.confidence),
      });
    }

    if (patches.length > 0) {
      const patchRows = patches.map((patch) => ({
        id: patch.patchId,
        optimization_run_id: runId,
        project_id: projectId,
        prompt_node_id: patch.promptNodeId,
        old_content: patch.oldContent,
        new_content: patch.newContent,
        rationale: patch.rationale,
        evidence: patch.evidence,
        confidence: patch.confidence,
        status: 'proposed',
      }));
      const patchInsert = await admin.from('optimization_run_patches').insert(patchRows);
      if (patchInsert.error) {
        throw new Error(`Failed to persist repair patches: ${patchInsert.error.message}`);
      }
    }

    const metrics = {
      deviations: deviations.length,
      proposedPatches: patches.length,
      candidatePromptNodes: promptNodes.length,
      model: resolveModelLabel(),
    };

    const updateRun = await admin
      .from('optimization_runs')
      .update({
        status: 'succeeded',
        output_patch: {
          patchIds: patches.map((patch) => patch.patchId),
        },
        metrics,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (updateRun.error) {
      throw new Error(`Failed to finalize optimization run: ${updateRun.error.message}`);
    }

    return jsonResponse(200, {
      runId,
      summary: {
        deviations: deviations.length,
        proposedPatches: patches.length,
        estimatedImpact: patches.length > 0
          ? 'Targeted node-level repairs available for manual review.'
          : 'No critical deviations detected.',
      },
      patches: patches.map((patch) => ({
        patchId: patch.patchId,
        promptNodeId: patch.promptNodeId,
        oldContent: patch.oldContent,
        newContent: patch.newContent,
        rationale: patch.rationale,
        evidence: patch.evidence,
      })),
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

function normalizeRequiredId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function normalizeObjective(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Improve prompt adherence to canonical transcript flow.';
  }
  const trimmed = value.trim();
  return trimmed || 'Improve prompt adherence to canonical transcript flow.';
}

function normalizeApplyMode(value: unknown): string {
  if (typeof value !== 'string') return 'manual';
  const trimmed = value.trim();
  return trimmed || 'manual';
}

async function assertOwnership(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  projectId: string,
  transcriptSetId: string,
): Promise<void> {
  const [projectRes, setRes] = await Promise.all([
    admin.from('projects').select('id').eq('id', projectId).eq('owner_id', userId).maybeSingle(),
    admin.from('transcript_sets').select('id').eq('id', transcriptSetId).eq('owner_id', userId).maybeSingle(),
  ]);

  if (projectRes.error) {
    throw new Error(`Failed to verify project access: ${projectRes.error.message}`);
  }
  if (setRes.error) {
    throw new Error(`Failed to verify transcript set access: ${setRes.error.message}`);
  }
  if (!projectRes.data) {
    throw new Error('Project not found.');
  }
  if (!setRes.data) {
    throw new Error('Transcript set not found.');
  }
}

async function loadPromptNodes(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<PromptNodeRecord[]> {
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
    label: normalizeText(row.label, 'Untitled prompt section'),
    type: normalizeText(row.type, 'custom'),
    content: normalizeText(row.content, ''),
  }));
}

async function loadCanonicalNodes(
  admin: ReturnType<typeof createAdminClient>,
  transcriptSetId: string,
): Promise<CanonicalNodeRecord[]> {
  const res = await admin
    .from('canonical_flow_nodes')
    .select('id, label, type, content, support_count')
    .eq('transcript_set_id', transcriptSetId);
  if (res.error) {
    throw new Error(`Failed to load canonical flow nodes: ${res.error.message}`);
  }
  return (res.data ?? []).map((row) => ({
    id: row.id,
    label: normalizeText(row.label, 'Untitled canonical step'),
    type: normalizeText(row.type, 'custom'),
    content: normalizeText(row.content, ''),
    supportCount: Math.max(0, row.support_count ?? 0),
  }));
}

function findBestCandidate(promptNode: PromptNodeRecord, canonicalNodes: CanonicalNodeRecord[]): Candidate {
  if (canonicalNodes.length === 0) {
    return { canonical: null, score: 0 };
  }

  let best: Candidate = { canonical: null, score: 0 };
  for (const canonicalNode of canonicalNodes) {
    const score = similarityScore(
      `${promptNode.label} ${promptNode.content}`,
      `${canonicalNode.label} ${canonicalNode.content}`,
    );
    if (!best.canonical || score > best.score) {
      best = { canonical: canonicalNode, score };
    }
  }
  return best;
}

async function proposeRepairPatch(
  promptNode: PromptNodeRecord,
  candidate: Candidate,
  objective: string,
): Promise<{
  newContent: string;
  rationale: string;
  confidence: number;
  evidence: string[];
}> {
  const canonical = candidate.canonical;
  if (!canonical) {
    return deterministicFallbackPatch(promptNode, null, candidate.score);
  }

  try {
    const result = await generateStructuredJson({
      messages: [
        {
          role: 'system',
          content: [
            'You repair a single prompt node using canonical call-flow evidence.',
            'Return JSON only.',
            'Keep edits concise and preserve operational details.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Objective: ${objective}`,
            '',
            `Prompt node label: ${promptNode.label}`,
            `Prompt node type: ${promptNode.type}`,
            'Current prompt node content:',
            promptNode.content || '(empty)',
            '',
            `Canonical node label: ${canonical.label}`,
            `Canonical node type: ${canonical.type}`,
            `Canonical support count: ${canonical.supportCount}`,
            'Canonical node content:',
            canonical.content || '(empty)',
            '',
            `Deterministic similarity score: ${candidate.score.toFixed(2)}`,
            '',
            'Return a revised prompt node content aligned to the canonical behavior while keeping it implementation-ready.',
          ].join('\n'),
        },
      ],
      schema: REPAIR_SCHEMA,
      schemaName: 'prompt_node_repair_patch',
      temperature: 0.2,
      groqModel: resolveDefaultGroqModel(),
      openAiModel: resolveDefaultOpenAiModel(),
      maxTokens: 900,
    });

    if (!isRecord(result.payload)) {
      return deterministicFallbackPatch(promptNode, canonical, candidate.score);
    }

    const newContent = normalizeText(result.payload.newContent, promptNode.content);
    const rationale = normalizeText(
      result.payload.rationale,
      `Aligned "${promptNode.label}" to canonical step "${canonical.label}".`,
    );
    const confidence = toNumber(result.payload.confidence, clamp01(candidate.score + 0.1));
    const evidence = Array.isArray(result.payload.evidence)
      ? result.payload.evidence
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, 5)
      : [`Canonical node "${canonical.label}" support=${canonical.supportCount}`];

    return {
      newContent,
      rationale,
      confidence,
      evidence: evidence.length > 0 ? evidence : [`Canonical node "${canonical.label}"`],
    };
  } catch {
    return deterministicFallbackPatch(promptNode, canonical, candidate.score);
  }
}

function deterministicFallbackPatch(
  promptNode: PromptNodeRecord,
  canonicalNode: CanonicalNodeRecord | null,
  score: number,
): {
  newContent: string;
  rationale: string;
  confidence: number;
  evidence: string[];
} {
  if (!canonicalNode) {
    return {
      newContent: [
        promptNode.content.trim(),
        '',
        'Add explicit branching criteria and escalation behavior for uncovered transcript variants.',
      ].join('\n').trim(),
      rationale: 'No canonical match found; expanded node instructions for fallback handling.',
      confidence: clamp01(score + 0.15),
      evidence: ['No canonical node candidate exceeded threshold.'],
    };
  }

  const revised = [
    promptNode.content.trim(),
    '',
    'Canonical alignment update:',
    canonicalNode.content.trim(),
  ].filter((line) => line.length > 0).join('\n');

  return {
    newContent: revised,
    rationale: `Merged canonical behavior from "${canonicalNode.label}" into "${promptNode.label}".`,
    confidence: clamp01(Math.max(score, 0.55)),
    evidence: [
      `Canonical step: ${canonicalNode.label}`,
      `Canonical support count: ${canonicalNode.supportCount}`,
    ],
  };
}

function similarityScore(leftText: string, rightText: string): number {
  const left = tokenize(leftText);
  const right = tokenize(rightText);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function tokenize(value: string): Set<string> {
  const matches = value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  return new Set(matches.filter((token) => !STOP_WORDS.has(token)));
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function resolveModelLabel(): string {
  if ((Deno.env.get('GROQ_API_KEY') ?? '').trim()) {
    return `groq:${resolveDefaultGroqModel()}`;
  }
  if ((Deno.env.get('OPENAI_API_KEY') ?? '').trim()) {
    return `openai:${resolveDefaultOpenAiModel()}`;
  }
  return 'deterministic';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
