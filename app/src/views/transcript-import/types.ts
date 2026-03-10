import type { TranscriptFlowResult } from '../../transcript-flow';

export type LayoutPosition = {
  x: number;
  y: number;
};

export type LayoutMap = Record<string, LayoutPosition>;

export type NodeVisualSize = {
  width: number;
  height: number;
};

export type NodeSizeMap = Record<string, NodeVisualSize>;

export type FlowRenderState = {
  layout: LayoutMap;
  nodeSizes: NodeSizeMap;
  geometry: { width: number; height: number };
};

export type MessageTone = 'info' | 'success' | 'error';
export type WorkspaceSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface TranscriptFile {
  id: string;
  name: string;
  content: string;
}

export interface TranscriptImportState {
  projectName: string;
  projectModel: string;
  transcripts: TranscriptFile[];
  assistantName: string;
  userName: string;
  generatedFlow: TranscriptFlowResult | null;
  generationError: string;
  validationWarnings: string[];
  isGenerating: boolean;
  isHydratingWorkspace: boolean;
  processingProgress: { processed: number; total: number } | null;
  flowRevision: number;
  selectedConnectionIndex: number | null;
  transcriptSetId: string | null;
  persistenceMessage: { tone: MessageTone; text: string } | null;
  workspaceSaveStatus: WorkspaceSaveStatus;
  workspaceSaveMessage: string | null;
  workspaceSavedAt: string | null;
  generatedPromptMarkdown: string;
  promptGenerationMessage: { tone: MessageTone; text: string } | null;
  isGeneratingPrompt: boolean;
  nodePositionOverrides: LayoutMap;
  latestRenderedLayout: LayoutMap;
  latestRenderedNodeSizes: NodeSizeMap;
  generatingThoughts: string[];
  viewport: {
    zoom: number | null;
    panX: number | null;
    panY: number | null;
  };
  sidebar: {
    inputCollapsed: boolean;
    nodesCollapsed: boolean;
    nodeSearchQuery: string;
  };
}
