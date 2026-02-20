import { supabase } from './supabase';
import type { TranscriptFlowResult } from './transcript-flow';

export interface PersistTranscriptFlowArtifactsRequest {
  transcript: string;
  flow: TranscriptFlowResult;
  projectName: string;
  projectId?: string | null;
  transcriptSetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PersistTranscriptFlowArtifactsResult {
  transcriptSetId: string;
  transcriptId: string;
  transcriptFlowId: string;
}

export async function persistTranscriptFlowArtifacts(
  request: PersistTranscriptFlowArtifactsRequest,
): Promise<PersistTranscriptFlowArtifactsResult> {
  const userId = await resolveCurrentUserId();

  let transcriptSetId = request.transcriptSetId ?? null;
  if (!transcriptSetId) {
    const transcriptSetRes = await supabase
      .from('transcript_sets')
      .insert({
        owner_id: userId,
        project_id: request.projectId ?? null,
        name: buildTranscriptSetName(request.projectName),
        description: 'Transcript artifacts generated from import flow mapping.',
        source: 'transcript-import',
      })
      .select('id')
      .single();
    if (transcriptSetRes.error || !transcriptSetRes.data?.id) {
      throw new Error(transcriptSetRes.error?.message ?? 'Failed to create transcript set.');
    }
    transcriptSetId = transcriptSetRes.data.id;
  }

  const transcriptRes = await supabase
    .from('transcripts')
    .insert({
      transcript_set_id: transcriptSetId,
      title: buildTranscriptTitle(request.projectName),
      transcript_text: request.transcript,
      metadata: request.metadata ?? {},
    })
    .select('id')
    .single();

  if (transcriptRes.error || !transcriptRes.data?.id) {
    throw new Error(transcriptRes.error?.message ?? 'Failed to persist transcript.');
  }

  const transcriptId = transcriptRes.data.id;

  const flowRes = await supabase
    .from('transcript_flows')
    .insert({
      transcript_id: transcriptId,
      model: request.flow.model,
      flow_title: request.flow.title,
      flow_summary: request.flow.summary,
      nodes_json: request.flow.nodes as unknown[],
      connections_json: request.flow.connections as unknown[],
      used_fallback: request.flow.usedFallback,
      warning: request.flow.warning ?? '',
    })
    .select('id')
    .single();

  if (flowRes.error || !flowRes.data?.id) {
    throw new Error(flowRes.error?.message ?? 'Failed to persist transcript flow artifacts.');
  }

  return {
    transcriptSetId,
    transcriptId,
    transcriptFlowId: flowRes.data.id,
  };
}

async function resolveCurrentUserId(): Promise<string> {
  const sessionRes = await supabase.auth.getSession();
  if (sessionRes.error) {
    throw new Error(`Unable to read auth session: ${sessionRes.error.message}`);
  }

  const userId = sessionRes.data.session?.user.id;
  if (!userId) {
    throw new Error('No active session. Sign in and try again.');
  }

  return userId;
}

function buildTranscriptSetName(projectName: string): string {
  const normalized = projectName.trim();
  if (normalized.length === 0) return 'Transcript Set';
  return `${normalized} Transcript Set`;
}

function buildTranscriptTitle(projectName: string): string {
  const timestamp = new Date().toISOString();
  const normalized = projectName.trim() || 'Transcript';
  return `${normalized} @ ${timestamp}`;
}
