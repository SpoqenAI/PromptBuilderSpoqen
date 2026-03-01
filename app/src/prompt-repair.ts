import { supabase } from './supabase';

export interface PromptRepairRunRequest {
  projectId: string;
  transcriptSetId: string;
  objective?: string;
  applyMode?: 'manual';
}

export interface PromptRepairPatch {
  patchId: string;
  promptNodeId: string;
  oldContent: string;
  newContent: string;
  rationale: string;
  evidence: string[];
}

export interface PromptRepairRunResult {
  runId: string;
  summary: {
    deviations: number;
    proposedPatches: number;
    estimatedImpact: string;
  };
  patches: PromptRepairPatch[];
}

export interface ApplyPromptRepairResult {
  applied: number;
  skipped: number;
  newPromptVersionId: string;
}

interface PromptRepairRunResponse {
  runId?: unknown;
  summary?: unknown;
  patches?: unknown;
  error?: unknown;
}

interface ApplyPromptRepairResponse {
  applied?: unknown;
  skipped?: unknown;
  newPromptVersionId?: unknown;
  error?: unknown;
}

const SUPABASE_URL = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';

export async function runPromptRepair(request: PromptRepairRunRequest): Promise<PromptRepairRunResult> {
  const payload = await invokeFunction<PromptRepairRunResponse>('prompt-repair-run', {
    projectId: request.projectId,
    transcriptSetId: request.transcriptSetId,
    objective: request.objective,
    applyMode: request.applyMode ?? 'manual',
  });

  if (typeof payload.runId !== 'string' || !payload.runId.trim()) {
    throw new Error('Repair run did not return a run id.');
  }
  if (!isRecord(payload.summary)) {
    throw new Error('Repair run did not return summary metrics.');
  }

  const summary = {
    deviations: toInt(payload.summary.deviations),
    proposedPatches: toInt(payload.summary.proposedPatches),
    estimatedImpact: typeof payload.summary.estimatedImpact === 'string'
      ? payload.summary.estimatedImpact
      : '',
  };

  const patches = Array.isArray(payload.patches)
    ? payload.patches
      .filter(isRecord)
      .map((item): PromptRepairPatch => ({
        patchId: typeof item.patchId === 'string' ? item.patchId : '',
        promptNodeId: typeof item.promptNodeId === 'string' ? item.promptNodeId : '',
        oldContent: typeof item.oldContent === 'string' ? item.oldContent : '',
        newContent: typeof item.newContent === 'string' ? item.newContent : '',
        rationale: typeof item.rationale === 'string' ? item.rationale : '',
        evidence: Array.isArray(item.evidence)
          ? item.evidence.filter((value): value is string => typeof value === 'string')
          : [],
      }))
      .filter((item) => item.patchId.length > 0 && item.promptNodeId.length > 0)
    : [];

  return {
    runId: payload.runId,
    summary,
    patches,
  };
}

export async function applyPromptRepair(args: {
  runId: string;
  acceptedPatchIds: string[];
  rejectedPatchIds?: string[];
}): Promise<ApplyPromptRepairResult> {
  const payload = await invokeFunction<ApplyPromptRepairResponse>('apply-prompt-repair', {
    runId: args.runId,
    acceptedPatchIds: args.acceptedPatchIds,
    rejectedPatchIds: args.rejectedPatchIds ?? [],
  });

  return {
    applied: toInt(payload.applied),
    skipped: toInt(payload.skipped),
    newPromptVersionId: typeof payload.newPromptVersionId === 'string'
      ? payload.newPromptVersionId
      : '',
  };
}

async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Supabase environment is not configured.');
  }

  const sessionRes = await supabase.auth.getSession();
  if (sessionRes.error) {
    throw new Error(`Unable to read auth session: ${sessionRes.error.message}`);
  }
  const accessToken = sessionRes.data.session?.access_token;
  if (!accessToken) {
    throw new Error('Sign in to continue.');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json() as { error?: unknown } & T;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed (${response.status}).`);
  }
  if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
    throw new Error(payload.error);
  }
  return payload as T;
}

function toInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
