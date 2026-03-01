import { uid } from '../../models';
import { getAutoNodeColor, withNodeColorMeta } from '../../node-colors';
import type { TranscriptFlowNode } from '../../transcript-flow';
import { clearTranscriptSession } from './state';
import type { TranscriptImportState } from './types';
import { normalizeLineEndings } from './format';
import { defaultNodeSize } from './layout';

interface WireTranscriptImportEventsParams {
  container: HTMLElement;
  state: TranscriptImportState;
  suppressNextNodeClick: { value: boolean };
  render: () => void;
  onNavigateHome: () => void;
  onNavigateBack: () => void;
  onGenerateFlow: () => void;
  onGeneratePromptFromFlow: () => void;
  onOpenLinkedProject: () => void;
  onCreateProjectFromFlow: () => void;
  onFlowMutated: () => void;
  onCopyGeneratedPrompt: () => void | Promise<void>;
  onOpenNodeEditor: (node: TranscriptFlowNode) => void;
  onWorkspaceMetadataChanged: () => void;
}

interface FlowBlockData {
  type: TranscriptFlowNode['type'];
  label: string;
  icon: string;
  defaultContent: string;
}

const FLOW_BLOCK_DRAG_TYPE = 'application/x-spoqen-flow-block';
const GRID_SIZE = 20;

export function wireTranscriptImportEvents(
  params: WireTranscriptImportEventsParams,
): void {
  const {
    container,
    state,
    suppressNextNodeClick,
    render,
    onNavigateHome,
    onNavigateBack,
    onGenerateFlow,
    onGeneratePromptFromFlow,
    onOpenLinkedProject,
    onCreateProjectFromFlow,
    onFlowMutated,
    onCopyGeneratedPrompt,
    onOpenNodeEditor,
    onWorkspaceMetadataChanged,
  } = params;

  let armedPort: { nodeId: string; type: 'in' | 'out' } | null = null;

  container.querySelector<HTMLButtonElement>('#nav-home')?.addEventListener('click', () => {
    onNavigateHome();
  });

  container.querySelector<HTMLButtonElement>('#btn-back')?.addEventListener('click', () => {
    onNavigateBack();
  });

  container.querySelector<HTMLButtonElement>('#btn-toggle-input-section')?.addEventListener('click', () => {
    state.sidebar.inputCollapsed = !state.sidebar.inputCollapsed;
    render();
  });

  container.querySelector<HTMLButtonElement>('#btn-toggle-nodes-section')?.addEventListener('click', () => {
    state.sidebar.nodesCollapsed = !state.sidebar.nodesCollapsed;
    render();
  });

  const projectNameInput = container.querySelector<HTMLInputElement>('#transcript-project-name');
  projectNameInput?.addEventListener('input', () => {
    state.projectName = projectNameInput.value;
    onWorkspaceMetadataChanged();
  });

  const projectModelSelect = container.querySelector<HTMLSelectElement>('#transcript-project-model');
  projectModelSelect?.addEventListener('change', () => {
    state.projectModel = projectModelSelect.value;
    onWorkspaceMetadataChanged();
  });

  const assistantNameInput = container.querySelector<HTMLInputElement>('#transcript-assistant-name');
  assistantNameInput?.addEventListener('input', () => {
    state.assistantName = assistantNameInput.value;
  });

  const userNameInput = container.querySelector<HTMLInputElement>('#transcript-user-name');
  userNameInput?.addEventListener('input', () => {
    state.userName = userNameInput.value;
  });

  const searchInput = container.querySelector<HTMLInputElement>('#flow-node-search');
  searchInput?.addEventListener('input', () => {
    state.sidebar.nodeSearchQuery = searchInput.value;
    render();
  });

  const dropZone = container.querySelector<HTMLElement>('#transcript-drop-zone');
  const fileInput = container.querySelector<HTMLInputElement>('#transcript-file');

  container.querySelector<HTMLElement>('#btn-upload-transcript')?.addEventListener('click', (event) => {
    event.stopPropagation();
    fileInput?.click();
  });

  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('border-primary', 'bg-primary/5');
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-primary', 'bg-primary/5');
  });

  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('border-primary', 'bg-primary/5');
    if (event.dataTransfer?.files) {
      handleFiles(Array.from(event.dataTransfer.files));
    }
  });

  fileInput?.addEventListener('change', () => {
    if (fileInput.files) {
      handleFiles(Array.from(fileInput.files));
      fileInput.value = '';
    }
  });

  function handleFiles(files: File[]) {
    let processed = 0;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        state.transcripts.push({
          id: uid(),
          name: file.name,
          content: normalizeLineEndings(content),
        });
        processed += 1;
        if (processed === files.length) {
          state.generationError = '';
          state.persistenceMessage = null;
          state.generatedPromptMarkdown = '';
          state.promptGenerationMessage = null;
          render();
        }
      };
      reader.readAsText(file);
    }
  }

  container.querySelectorAll<HTMLButtonElement>('[data-remove-transcript]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = button.dataset.removeTranscript;
      state.transcripts = state.transcripts.filter((transcript) => transcript.id !== id);
      state.generatedPromptMarkdown = '';
      state.promptGenerationMessage = null;
      render();
    });
  });

  container.querySelector<HTMLButtonElement>('#btn-clear-transcript')?.addEventListener('click', () => {
    clearTranscriptSession(state);
    render();
  });

  container.querySelector<HTMLButtonElement>('#btn-generate-flow')?.addEventListener('click', () => {
    onGenerateFlow();
  });

  container.querySelector<HTMLButtonElement>('#btn-create-flow-project')?.addEventListener('click', () => {
    onCreateProjectFromFlow();
  });
  container.querySelector<HTMLButtonElement>('#btn-open-linked-project')?.addEventListener('click', () => {
    onOpenLinkedProject();
  });

  container.querySelector<HTMLButtonElement>('#btn-generate-prompt-from-flow')?.addEventListener('click', () => {
    onGeneratePromptFromFlow();
  });

  container.querySelector<HTMLButtonElement>('#btn-copy-generated-prompt')?.addEventListener('click', () => {
    void onCopyGeneratedPrompt();
  });

  container.querySelector<HTMLButtonElement>('#btn-regenerate-flow')?.addEventListener('click', () => {
    onGenerateFlow();
  });

  const addNodeFromBlock = (blockData: FlowBlockData, location: { x: number; y: number } | null): void => {
    const flow = ensureEditableFlow(state);
    const nodeId = uid();
    const autoColor = getAutoNodeColor(flow.nodes.length);
    const basePosition = resolveInsertionPoint(state);
    const nextPosition = location ?? basePosition;

    flow.nodes.push({
      id: nodeId,
      type: blockData.type,
      label: blockData.label,
      icon: blockData.icon,
      content: blockData.defaultContent || blockData.label,
      meta: withNodeColorMeta({}, autoColor),
    });
    state.nodePositionOverrides[nodeId] = {
      x: snapToGrid(nextPosition.x),
      y: snapToGrid(nextPosition.y),
    };
    onFlowMutated();
  };

  container.querySelectorAll<HTMLElement>('.transcript-node-block').forEach((blockEl) => {
    const blockData = parseFlowBlockData(blockEl);
    if (!blockData) return;

    blockEl.addEventListener('dragstart', (event: DragEvent) => {
      const payload = JSON.stringify(blockData);
      event.dataTransfer?.setData(FLOW_BLOCK_DRAG_TYPE, payload);
      event.dataTransfer?.setData('text/plain', payload);
      event.dataTransfer?.setData('application/json', payload);
    });

    blockEl.addEventListener('click', () => {
      addNodeFromBlock(blockData, null);
    });
  });

  const flowViewport = container.querySelector<HTMLElement>('#flow-viewport');
  flowViewport?.addEventListener('dragover', (event: DragEvent) => {
    const hasPayload = Boolean(
      event.dataTransfer?.types?.includes(FLOW_BLOCK_DRAG_TYPE)
      || event.dataTransfer?.types?.includes('text/plain'),
    );
    if (!hasPayload) return;
    event.preventDefault();
    flowViewport.classList.add('ring-2', 'ring-primary/30', 'ring-inset');
  });
  flowViewport?.addEventListener('dragleave', () => {
    flowViewport.classList.remove('ring-2', 'ring-primary/30', 'ring-inset');
  });
  flowViewport?.addEventListener('drop', (event: DragEvent) => {
    flowViewport.classList.remove('ring-2', 'ring-primary/30', 'ring-inset');
    const payload = event.dataTransfer?.getData(FLOW_BLOCK_DRAG_TYPE)
      || event.dataTransfer?.getData('application/json')
      || event.dataTransfer?.getData('text/plain');
    if (!payload) return;
    const blockData = parseFlowBlockPayload(payload);
    if (!blockData) return;
    event.preventDefault();

    const rect = flowViewport.getBoundingClientRect();
    const zoom = state.viewport.zoom ?? 1;
    const panX = state.viewport.panX ?? 0;
    const panY = state.viewport.panY ?? 0;
    const nodeSize = defaultNodeSize();
    const worldX = (event.clientX - rect.left - panX) / zoom;
    const worldY = (event.clientY - rect.top - panY) / zoom;
    const location = {
      x: snapToGrid(worldX - nodeSize.width / 2),
      y: snapToGrid(worldY - nodeSize.height / 2),
    };
    addNodeFromBlock(blockData, location);
  });

  container.querySelectorAll<HTMLElement>('[data-flow-edge]').forEach((edgeEl) => {
    edgeEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!state.generatedFlow) return;
      const rawIndex = edgeEl.dataset.flowEdge;
      const edgeIndex = typeof rawIndex === 'string' ? Number.parseInt(rawIndex, 10) : Number.NaN;
      if (!Number.isFinite(edgeIndex) || edgeIndex < 0 || edgeIndex >= state.generatedFlow.connections.length) {
        return;
      }
      state.generatedFlow.connections.splice(edgeIndex, 1);
      onFlowMutated();
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-flow-node-delete]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nodeId = button.dataset.flowNodeDelete ?? '';
      if (!nodeId || !state.generatedFlow) return;
      state.generatedFlow.nodes = state.generatedFlow.nodes.filter((node) => node.id !== nodeId);
      state.generatedFlow.connections = state.generatedFlow.connections.filter((connection) => (
        connection.from !== nodeId && connection.to !== nodeId
      ));
      delete state.nodePositionOverrides[nodeId];
      onFlowMutated();
    });
  });

  container.querySelectorAll<HTMLElement>('[data-flow-node-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (suppressNextNodeClick.value) return;
      if ((event.target as HTMLElement).closest('.port,[data-flow-node-delete]')) return;
      event.stopPropagation();
      const nodeId = element.dataset.flowNodeId ?? null;
      if (!nodeId || !state.generatedFlow) return;
      const node = state.generatedFlow.nodes.find((candidate) => candidate.id === nodeId);
      if (node) onOpenNodeEditor(node);
    });
  });

  container.querySelectorAll<HTMLElement>('.port[data-port-node-id][data-port-type]').forEach((portEl) => {
    portEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!state.generatedFlow) return;
      const nodeId = portEl.dataset.portNodeId ?? '';
      const type = portEl.dataset.portType === 'in' ? 'in' : 'out';
      if (!nodeId) return;

      if (!armedPort) {
        armedPort = { nodeId, type };
        return;
      }

      if (armedPort.nodeId === nodeId && armedPort.type === type) {
        armedPort = null;
        return;
      }

      let from: string | null = null;
      let to: string | null = null;
      if (armedPort.type === 'out' && type === 'in') {
        from = armedPort.nodeId;
        to = nodeId;
      } else if (armedPort.type === 'in' && type === 'out') {
        from = nodeId;
        to = armedPort.nodeId;
      } else {
        armedPort = { nodeId, type };
        return;
      }

      armedPort = null;
      if (!from || !to || from === to) return;

      const connectionExists = state.generatedFlow.connections.some((connection) => (
        connection.from === from && connection.to === to
      ));
      if (connectionExists) return;

      state.generatedFlow.connections.push({
        from,
        to,
        reason: 'Next',
      });
      onFlowMutated();
    });
  });
}

function parseFlowBlockData(blockEl: HTMLElement): FlowBlockData | null {
  const type = (blockEl.dataset.flowBlockType ?? '').trim();
  const label = (blockEl.dataset.flowBlockLabel ?? '').trim();
  const icon = (blockEl.dataset.flowBlockIcon ?? '').trim();
  const encodedDefault = blockEl.dataset.flowBlockDefault ?? '';
  if (!type || !label || !icon) return null;

  let defaultContent = '';
  try {
    defaultContent = decodeURIComponent(encodedDefault);
  } catch {
    defaultContent = encodedDefault;
  }

  return {
    type: type as TranscriptFlowNode['type'],
    label,
    icon,
    defaultContent,
  };
}

function parseFlowBlockPayload(payload: string): FlowBlockData | null {
  try {
    const parsed = JSON.parse(payload) as Partial<FlowBlockData> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      typeof parsed.type !== 'string'
      || typeof parsed.label !== 'string'
      || typeof parsed.icon !== 'string'
      || typeof parsed.defaultContent !== 'string'
    ) {
      return null;
    }
    return {
      type: parsed.type as TranscriptFlowNode['type'],
      label: parsed.label,
      icon: parsed.icon,
      defaultContent: parsed.defaultContent,
    };
  } catch {
    return null;
  }
}

function ensureEditableFlow(state: TranscriptImportState): NonNullable<TranscriptImportState['generatedFlow']> {
  if (state.generatedFlow) return state.generatedFlow;
  const title = state.projectName.trim() || 'Transcript Flow';
  state.generatedFlow = {
    title,
    summary: 'Editable transcript flow workspace.',
    model: state.projectModel.trim() || 'GPT-4o',
    nodes: [],
    connections: [],
    usedFallback: false,
    warning: null,
  };
  state.generationError = '';
  return state.generatedFlow;
}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function resolveInsertionPoint(state: TranscriptImportState): { x: number; y: number } {
  const nodeSize = defaultNodeSize();
  const positions = Object.values(state.latestRenderedLayout);
  if (positions.length === 0) {
    return { x: 80, y: 80 };
  }
  let maxX = positions[0].x;
  let anchorY = positions[0].y;
  for (const pos of positions) {
    if (pos.x >= maxX) {
      maxX = pos.x;
      anchorY = pos.y;
    }
  }
  return {
    x: snapToGrid(maxX + nodeSize.width + 56),
    y: snapToGrid(anchorY),
  };
}
