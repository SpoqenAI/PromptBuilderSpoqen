import {
  DEFAULT_PROJECT_MODEL,
  DEFAULT_PROJECT_NAME,
} from './constants';
import { buildGeneratingThoughtSequence } from './generating-thoughts';
import type { TranscriptImportState } from './types';

export function createTranscriptImportState(): TranscriptImportState {
  return {
    projectName: DEFAULT_PROJECT_NAME,
    projectModel: DEFAULT_PROJECT_MODEL,
    transcripts: [],
    assistantName: 'Assistant',
    userName: 'User',
    generatedFlow: null,
    generationError: '',
    isGenerating: false,
    processingProgress: null,
    flowRevision: 0,
    approvedRevision: -1,
    approvedAt: null,
    transcriptSetId: null,
    persistenceMessage: null,
    generatedPromptMarkdown: '',
    promptGenerationMessage: null,
    isGeneratingPrompt: false,
    nodePositionOverrides: {},
    latestRenderedLayout: {},
    latestRenderedNodeSizes: {},
    generatingThoughts: buildGeneratingThoughtSequence(),
    viewport: {
      zoom: null,
      panX: null,
      panY: null,
    },
  };
}

export function clearFlowApproval(state: TranscriptImportState): void {
  state.approvedRevision = -1;
  state.approvedAt = null;
}

export function isCurrentFlowApproved(state: TranscriptImportState): boolean {
  return state.generatedFlow !== null && state.approvedRevision === state.flowRevision;
}

export function clearTranscriptSession(state: TranscriptImportState): void {
  state.transcripts = [];
  state.generationError = '';
  state.processingProgress = null;
  state.generatedFlow = null;
  state.nodePositionOverrides = {};
  state.latestRenderedLayout = {};
  state.latestRenderedNodeSizes = {};
  state.flowRevision = 0;
  state.approvedRevision = -1;
  state.approvedAt = null;
  state.transcriptSetId = null;
  state.persistenceMessage = null;
  state.generatedPromptMarkdown = '';
  state.promptGenerationMessage = null;
  state.isGeneratingPrompt = false;
  state.viewport.zoom = null;
  state.viewport.panX = null;
  state.viewport.panY = null;
}
