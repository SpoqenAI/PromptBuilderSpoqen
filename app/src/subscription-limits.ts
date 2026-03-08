import { supabase } from './supabase';
import { getSubscription } from './billing';

const FREE_PROMPT_FLOW_LIMIT = 3;
const FREE_TRANSCRIPTION_FLOW_LIMIT = 3;
const FREE_TRANSCRIPT_SET_LIMIT = 3;

export interface SubscriptionLimits {
  isFreeTier: boolean;
  promptFlowCount: number;
  promptFlowLimit: number;
  canCreatePromptFlow: boolean;
  transcriptionFlowCount: number;
  transcriptionFlowLimit: number;
  canCreateTranscriptionFlow: boolean;
  transcriptSetCount: number;
  transcriptSetLimit: number;
  canCreateTranscriptSet: boolean;
  importPromptUsed: boolean;
  importTranscriptUsed: boolean;
  canUseImportPrompt: boolean;
  canUseImportTranscript: boolean;
}

export async function getSubscriptionLimits(): Promise<SubscriptionLimits> {
  const [subscription, projectsRes, transcriptionFlowRes, transcriptSetRes, featureUsageRes] = await Promise.all([
    getSubscription(),
    supabase.from('projects').select('id', { count: 'exact', head: true }),
    supabase.rpc('user_transcription_flow_count'),
    supabase.rpc('user_transcript_set_count'),
    supabase.from('feature_usage').select('feature_key'),
  ]);

  const isFreeTier = !subscription;

  const promptFlowCount = projectsRes.count ?? 0;
  const transcriptionFlowCount =
    typeof transcriptionFlowRes.data === 'number' ? transcriptionFlowRes.data : 0;
  const transcriptSetCount =
    typeof transcriptSetRes.data === 'number' ? transcriptSetRes.data : 0;

  const usedFeatures = new Set(
    (featureUsageRes.data as { feature_key: string }[] | null)?.map((r) => r.feature_key) ?? [],
  );
  const importPromptUsed = usedFeatures.has('import_prompt');
  const importTranscriptUsed = usedFeatures.has('import_transcript');

  return {
    isFreeTier,
    promptFlowCount,
    promptFlowLimit: FREE_PROMPT_FLOW_LIMIT,
    canCreatePromptFlow: !isFreeTier || promptFlowCount < FREE_PROMPT_FLOW_LIMIT,
    transcriptionFlowCount,
    transcriptionFlowLimit: FREE_TRANSCRIPTION_FLOW_LIMIT,
    canCreateTranscriptionFlow: !isFreeTier || transcriptionFlowCount < FREE_TRANSCRIPTION_FLOW_LIMIT,
    transcriptSetCount,
    transcriptSetLimit: FREE_TRANSCRIPT_SET_LIMIT,
    canCreateTranscriptSet: !isFreeTier || transcriptSetCount < FREE_TRANSCRIPT_SET_LIMIT,
    importPromptUsed,
    importTranscriptUsed,
    canUseImportPrompt: !isFreeTier || !importPromptUsed,
    canUseImportTranscript: !isFreeTier || !importTranscriptUsed,
  };
}

export async function recordFeatureUsage(featureKey: 'import_prompt' | 'import_transcript'): Promise<void> {
  await supabase.from('feature_usage').insert({ feature_key: featureKey });
}

export { getSubscriptionLimits as useSubscriptionLimits };
