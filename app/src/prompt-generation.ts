import { supabase } from './supabase';

export interface FlowToPromptRequest {
  transcriptSetId: string;
  projectId?: string;
  mode?: 'runtime' | 'flow-template';
}

export interface FlowToPromptMapping {
  canonicalNodeId: string;
  promptNodeId?: string;
  sectionHeading: string;
}

export interface FlowToPromptResult {
  promptMarkdown: string;
  nodeMappings: FlowToPromptMapping[];
  model: string;
  usedFallback: boolean;
  warning: string | null;
}

interface FlowToPromptResponse {
  promptMarkdown?: unknown;
  nodeMappings?: unknown;
  model?: unknown;
  usedFallback?: unknown;
  warning?: unknown;
  error?: unknown;
}

const SUPABASE_URL = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';

export async function generatePromptFromFlow(request: FlowToPromptRequest): Promise<FlowToPromptResult> {
  if (!request.transcriptSetId.trim()) {
    throw new Error('transcriptSetId is required.');
  }
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Supabase environment is not configured.');
  }

  const sessionRes = await supabase.auth.getSession();
  if (sessionRes.error) {
    throw new Error(`Unable to read auth session: ${sessionRes.error.message}`);
  }
  const accessToken = sessionRes.data.session?.access_token;
  if (!accessToken) {
    throw new Error('Sign in to generate prompts from flow.');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/flow-to-prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      transcriptSetId: request.transcriptSetId,
      ...(request.projectId ? { projectId: request.projectId } : {}),
      ...(request.mode ? { mode: request.mode } : {}),
    }),
  });

  const payload = await response.json() as FlowToPromptResponse;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed (${response.status}).`);
  }
  if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
    throw new Error(payload.error);
  }

  const promptMarkdown = typeof payload.promptMarkdown === 'string' ? payload.promptMarkdown : '';
  if (!promptMarkdown.trim()) {
    throw new Error('Flow-to-prompt generation returned empty prompt content.');
  }

  const nodeMappings = Array.isArray(payload.nodeMappings)
    ? payload.nodeMappings
      .filter(isRecord)
      .map((item) => ({
        canonicalNodeId: typeof item.canonicalNodeId === 'string' ? item.canonicalNodeId : '',
        ...(typeof item.promptNodeId === 'string' && item.promptNodeId.trim().length > 0
          ? { promptNodeId: item.promptNodeId }
          : {}),
        sectionHeading: typeof item.sectionHeading === 'string' ? item.sectionHeading : '',
      }))
      .filter((item) => item.canonicalNodeId.length > 0)
    : [];

  return {
    promptMarkdown,
    nodeMappings,
    model: typeof payload.model === 'string' ? payload.model : 'unknown',
    usedFallback: payload.usedFallback === true,
    warning: typeof payload.warning === 'string' && payload.warning.trim().length > 0
      ? payload.warning
      : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
