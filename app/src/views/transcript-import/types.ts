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
  isGenerating: boolean;
  processingProgress: { processed: number; total: number } | null;
  flowRevision: number;
  approvedRevision: number;
  approvedAt: string | null;
  transcriptSetId: string | null;
  persistenceMessage: { tone: MessageTone; text: string } | null;
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
}
