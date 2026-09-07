import type { PromptNode } from '../../models';

export interface CanvasViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface CanvasViewContainer extends HTMLElement {
  __pbCanvasCleanup?: () => void;
}

export interface NodeVisualSize {
  width: number;
  height: number;
}

export interface SidebarBlock {
  type: PromptNode['type'];
  label: string;
  icon: string;
  category: string;
  defaultContent: string;
  meta: Record<string, string>;
  templateId?: string;
  isCustomTemplate: boolean;
}

export type WorkspaceMode = 'prompt' | 'transcript';

export interface StagedTranscriptFile {
  id: string;
  name: string;
  content: string;
}

export interface McpRelayConfig {
  enabled: boolean;
  canvasSyncUrl: string | null;
  agentRelayUrl: string | null;
  reason: string | null;
}

export const MIN_CANVAS_SIDEBAR_WIDTH = 200;
export const MAX_CANVAS_SIDEBAR_WIDTH = 560;
