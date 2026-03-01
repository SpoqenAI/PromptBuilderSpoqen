import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';

interface RequestBody {
  runId?: unknown;
  acceptedPatchIds?: unknown;
  rejectedPatchIds?: unknown;
}

interface RepairPatchRow {
  id: string;
  prompt_node_id: string;
  new_content: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, req);
  }

  try {
    const body = await parseJson<RequestBody>(req);
    const runId = normalizeRequiredId(body.runId, 'runId');
    const acceptedPatchIds = normalizeIdList(body.acceptedPatchIds);
    const rejectedPatchIds = normalizeIdList(body.rejectedPatchIds);

    const admin = createAdminClient();
    const user = await requireUser(req, admin);

    const runRes = await admin
      .from('optimization_runs')
      .select('id, transcript_set_id, project_id, status')
      .eq('id', runId)
      .maybeSingle();
    if (runRes.error) {
      throw new Error(`Failed to load optimization run: ${runRes.error.message}`);
    }
    if (!runRes.data) {
      throw new Error('Optimization run not found.');
    }
    if (!runRes.data.project_id) {
      throw new Error('Optimization run has no linked project.');
    }
    const projectId = runRes.data.project_id;

    const [projectRes, setRes] = await Promise.all([
      admin.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).maybeSingle(),
      admin.from('transcript_sets').select('id').eq('id', runRes.data.transcript_set_id).eq('owner_id', user.id).maybeSingle(),
    ]);
    if (projectRes.error) {
      throw new Error(`Failed to verify project access: ${projectRes.error.message}`);
    }
    if (setRes.error) {
      throw new Error(`Failed to verify transcript set access: ${setRes.error.message}`);
    }
    if (!projectRes.data || !setRes.data) {
      throw new Error('You do not have access to this optimization run.');
    }

    const patchRes = await admin
      .from('optimization_run_patches')
      .select('id, prompt_node_id, new_content')
      .eq('optimization_run_id', runId);
    if (patchRes.error) {
      throw new Error(`Failed to load run patches: ${patchRes.error.message}`);
    }

    const allPatches = (patchRes.data ?? []) as RepairPatchRow[];
    const acceptedSet = new Set(acceptedPatchIds);
    const accepted = allPatches.filter((patch) => acceptedSet.has(patch.id));
    const rejectedSet = new Set(rejectedPatchIds);

    for (const patch of accepted) {
      const nodeUpdate = await admin
        .from('prompt_nodes')
        .update({ content: patch.new_content })
        .eq('id', patch.prompt_node_id)
        .eq('project_id', projectId);
      if (nodeUpdate.error) {
        throw new Error(`Failed to apply patch ${patch.id}: ${nodeUpdate.error.message}`);
      }
    }

    if (accepted.length > 0) {
      const updateAccepted = await admin
        .from('optimization_run_patches')
        .update({ status: 'applied', updated_at: new Date().toISOString() })
        .eq('optimization_run_id', runId)
        .in('id', accepted.map((patch) => patch.id));
      if (updateAccepted.error) {
        throw new Error(`Failed to update applied patch statuses: ${updateAccepted.error.message}`);
      }
    }

    const rejectedToUpdate = allPatches
      .filter((patch) => rejectedSet.has(patch.id))
      .map((patch) => patch.id);
    if (rejectedToUpdate.length > 0) {
      const updateRejected = await admin
        .from('optimization_run_patches')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('optimization_run_id', runId)
        .in('id', rejectedToUpdate);
      if (updateRejected.error) {
        throw new Error(`Failed to update rejected patch statuses: ${updateRejected.error.message}`);
      }
    }

    const snapshot = await buildPromptSnapshot(admin, projectId);
    const promptVersionInsert = await admin
      .from('prompt_versions')
      .insert({
        project_id: projectId,
        content: snapshot.runtimePrompt,
        notes: `Applied prompt repair run ${runId}`,
        snapshot_json: snapshot.snapshotJson,
      })
      .select('id')
      .single();
    if (promptVersionInsert.error || !promptVersionInsert.data?.id) {
      throw new Error(promptVersionInsert.error?.message ?? 'Failed to create prompt version snapshot.');
    }

    const runUpdate = await admin
      .from('optimization_runs')
      .update({
        status: 'succeeded',
        output_patch: {
          appliedPatchIds: accepted.map((patch) => patch.id),
          rejectedPatchIds: rejectedToUpdate,
        },
        metrics: {
          applied: accepted.length,
          rejected: rejectedToUpdate.length,
          totalPatches: allPatches.length,
        },
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (runUpdate.error) {
      throw new Error(`Failed to finalize optimization run: ${runUpdate.error.message}`);
    }

    return jsonResponse(200, {
      applied: accepted.length,
      skipped: Math.max(0, allPatches.length - accepted.length),
      newPromptVersionId: promptVersionInsert.data.id,
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

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!normalized) continue;
    output.push(normalized);
  }
  return output;
}

async function buildPromptSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<{
  runtimePrompt: string;
  snapshotJson: {
    nodes: Array<{
      id: string;
      type: string;
      label: string;
      icon: string;
      x: number;
      y: number;
      content: string;
      meta: Record<string, unknown>;
    }>;
    connections: Array<{
      id: string;
      from: string;
      to: string;
      label?: string;
    }>;
  };
}> {
  const nodesRes = await admin
    .from('prompt_nodes')
    .select('id, type, label, icon, x, y, content, meta, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (nodesRes.error) {
    throw new Error(`Failed to load prompt nodes for snapshot: ${nodesRes.error.message}`);
  }

  const connectionsRes = await admin
    .from('connections')
    .select('id, from_node_id, to_node_id, label')
    .eq('project_id', projectId);
  if (connectionsRes.error && isMissingConnectionLabelColumn(connectionsRes.error.message)) {
    const fallbackConnectionsRes = await admin
      .from('connections')
      .select('id, from_node_id, to_node_id')
      .eq('project_id', projectId);
    if (fallbackConnectionsRes.error) {
      throw new Error(`Failed to load connections for snapshot: ${fallbackConnectionsRes.error.message}`);
    }
    const nodes = (nodesRes.data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      label: row.label,
      icon: row.icon,
      x: row.x,
      y: row.y,
      content: row.content,
      meta: (row.meta ?? {}) as Record<string, unknown>,
    }));
    const connections = (fallbackConnectionsRes.data ?? []).map((row) => ({
      id: row.id,
      from: row.from_node_id,
      to: row.to_node_id,
    }));
    return {
      runtimePrompt: nodes.map((node) => node.content).join('\n\n'),
      snapshotJson: { nodes, connections },
    };
  }
  if (connectionsRes.error) {
    throw new Error(`Failed to load connections for snapshot: ${connectionsRes.error.message}`);
  }

  const nodes = (nodesRes.data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    label: row.label,
    icon: row.icon,
    x: row.x,
    y: row.y,
    content: row.content,
    meta: (row.meta ?? {}) as Record<string, unknown>,
  }));
  const connections = (connectionsRes.data ?? []).map((row) => ({
    id: row.id,
    from: row.from_node_id,
    to: row.to_node_id,
    ...(typeof row.label === 'string' && row.label.trim().length > 0 ? { label: row.label.trim() } : {}),
  }));

  return {
    runtimePrompt: nodes.map((node) => node.content).join('\n\n'),
    snapshotJson: {
      nodes,
      connections,
    },
  };
}

function isMissingConnectionLabelColumn(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('label') && normalized.includes('connections') && (
    normalized.includes('does not exist') || normalized.includes('schema cache')
  );
}
