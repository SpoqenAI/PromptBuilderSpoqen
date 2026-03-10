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
    validationWarnings: [],
    isGenerating: false,
    isHydratingWorkspace: false,
    processingProgress: null,
    flowRevision: 0,
    selectedConnectionIndex: null,
    transcriptSetId: null,
    persistenceMessage: null,
    workspaceSaveStatus: 'idle',
    workspaceSaveMessage: null,
    workspaceSavedAt: null,
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
    sidebar: {
      inputCollapsed: false,
      nodesCollapsed: false,
      nodeSearchQuery: '',
    },
  };
}

export function clearTranscriptSession(state: TranscriptImportState): void {
  state.transcripts = [];
  state.generationError = '';
  state.validationWarnings = [];
  state.processingProgress = null;
  state.generatedFlow = null;
  state.isHydratingWorkspace = false;
  state.nodePositionOverrides = {};
  state.latestRenderedLayout = {};
  state.latestRenderedNodeSizes = {};
  state.flowRevision = 0;
  state.selectedConnectionIndex = null;
  state.transcriptSetId = null;
  state.persistenceMessage = null;
  state.workspaceSaveStatus = 'idle';
  state.workspaceSaveMessage = null;
  state.workspaceSavedAt = null;
  state.generatedPromptMarkdown = '';
  state.promptGenerationMessage = null;
  state.isGeneratingPrompt = false;
  state.viewport.zoom = null;
  state.viewport.panX = null;
  state.viewport.panY = null;
  state.sidebar.inputCollapsed = false;
  state.sidebar.nodesCollapsed = false;
  state.sidebar.nodeSearchQuery = '';
}
