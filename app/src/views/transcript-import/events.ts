import { customPrompt, customConfirm, customAlert } from '../../dialogs';
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

type PortType = 'in' | 'out';

interface ConnectionDraft {
  nodeId: string;
  portType: PortType;
  armedByClick: boolean;
}

const FLOW_BLOCK_DRAG_TYPE = 'application/x-spoqen-flow-block';
const GRID_SIZE = 20;

export function wireTranscriptImportEvents(
  params: WireTranscriptImportEventsParams,
): () => void {
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

  const flowViewport = container.querySelector<HTMLElement>('#flow-viewport');
  const connectionSvg = container.querySelector<SVGSVGElement>('#flow-connections-svg');
  const documentCleanup: Array<() => void> = [];
  let connectionDraft: ConnectionDraft | null = null;
  let tempLine: SVGLineElement | null = null;
  let connectPointerStartX = 0;
  let connectPointerStartY = 0;
  let connectPointerMoved = false;
  let suppressNextPortClick = false;

  const quotaHandler = (event: Event): void => {
    const detail = (event as CustomEvent<{ kind: string; message: string }>).detail;
    if (!detail || detail.kind !== 'project_rls') return;
    void (async () => {
      await customAlert(detail.message);
    })();
  };
  window.addEventListener('store:quota-error', quotaHandler);
  documentCleanup.push(() => {
    window.removeEventListener('store:quota-error', quotaHandler);
  });

  const addDocumentListener = <K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void => {
    document.addEventListener(type, handler as EventListener, options);
    documentCleanup.push(() => {
      document.removeEventListener(type, handler as EventListener, options);
    });
  };

  const setSelectedConnection = (nextIndex: number | null, shouldRender = true): void => {
    const flow = state.generatedFlow;
    if (
      nextIndex !== null
      && (!flow || nextIndex < 0 || nextIndex >= flow.connections.length)
    ) {
      nextIndex = null;
    }
    if (state.selectedConnectionIndex === nextIndex) return;
    state.selectedConnectionIndex = nextIndex;
    if (shouldRender) render();
  };

  const resolveEdgeIndexAtClient = (clientX: number, clientY: number): number | null => {
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!target) return null;
    const hitPath = target.closest<HTMLElement>('[data-flow-edge-hit-index]');
    const hitPathIndex = parseEdgeIndex(hitPath?.dataset.flowEdgeHitIndex);
    if (hitPathIndex !== null) return hitPathIndex;
    const edgeGroup = target.closest<HTMLElement>('[data-flow-edge]');
    return parseEdgeIndex(edgeGroup?.dataset.flowEdge);
  };

  const isTypingTarget = (target: EventTarget | null): boolean => {
    const element = target as HTMLElement | null;
    if (!element) return false;
    return (
      element.tagName === 'INPUT'
      || element.tagName === 'TEXTAREA'
      || element.isContentEditable
    );
  };

  const deleteSelectedConnection = (): void => {
    const flow = state.generatedFlow;
    const index = state.selectedConnectionIndex;
    if (!flow || index === null || index < 0 || index >= flow.connections.length) {
      setSelectedConnection(null);
      return;
    }
    flow.connections.splice(index, 1);
    state.selectedConnectionIndex = null;
    onFlowMutated();
  };

  const editConnectionReason = async (index: number): Promise<void> => {
    const flow = state.generatedFlow;
    if (!flow || index < 0 || index >= flow.connections.length) return;
    const connection = flow.connections[index];
    const nextReason = await customPrompt('Branch label (optional):', connection.reason ?? '');
    if (nextReason === null) return;
    connection.reason = normalizeConnectionReason(nextReason);
    onFlowMutated();
  };

  const clearPortHighlights = (): void => {
    container.querySelectorAll<HTMLElement>('.port').forEach((port) => {
      port.classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
      port.style.transform = '';
    });
  };

  const clearConnectionDraft = (): void => {
    if (tempLine) {
      tempLine.remove();
      tempLine = null;
    }
    connectionDraft = null;
    connectPointerMoved = false;
    clearPortHighlights();
  };

  const suppressPortClickOnce = (): void => {
    suppressNextPortClick = true;
    setTimeout(() => {
      suppressNextPortClick = false;
    }, 0);
  };

  const clientToWorld = (clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!flowViewport) return null;
    const zoom = state.viewport.zoom ?? 1;
    const panX = state.viewport.panX ?? 0;
    const panY = state.viewport.panY ?? 0;
    const rect = flowViewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panX) / zoom,
      y: (clientY - rect.top - panY) / zoom,
    };
  };

  const getPortCenter = (portEl: HTMLElement): { x: number; y: number } | null => {
    if (!flowViewport) return null;
    const rect = portEl.getBoundingClientRect();
    return clientToWorld(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  };

  const resolveConnection = (
    startNodeId: string,
    startPortType: PortType,
    endNodeId: string,
    endPortType: PortType,
  ): { from: string; to: string } | null => {
    if (startNodeId === endNodeId) return null;
    if (startPortType === 'out' && endPortType === 'in') return { from: startNodeId, to: endNodeId };
    if (startPortType === 'in' && endPortType === 'out') return { from: endNodeId, to: startNodeId };
    return null;
  };

  const getPortTypeFromElement = (portEl: HTMLElement): PortType => (
    portEl.dataset.portType === 'in' ? 'in' : 'out'
  );

  const highlightConnectionTargets = (draft: ConnectionDraft): void => {
    clearPortHighlights();
    const startSelector = draft.portType === 'out' ? '.port-out' : '.port-in';
    const startPort = container.querySelector<HTMLElement>(
      `.canvas-node[data-flow-node-id="${draft.nodeId}"] ${startSelector}`,
    );
    if (startPort) {
      startPort.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
      startPort.style.transform = 'scale(1.2)';
    }

    const targetSelector = draft.portType === 'out' ? '.port-in' : '.port-out';
    container.querySelectorAll<HTMLElement>(targetSelector).forEach((port) => {
      if (port.dataset.portNodeId === draft.nodeId) return;
      port.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
      port.style.transform = 'scale(1.3)';
    });
  };

  const armConnectionFromPort = (nodeId: string, portType: PortType): void => {
    clearConnectionDraft();
    connectionDraft = { nodeId, portType, armedByClick: true };
    highlightConnectionTargets(connectionDraft);
  };

  const beginDragConnectionFromPort = (
    portEl: HTMLElement,
    nodeId: string,
    portType: PortType,
    event: MouseEvent,
  ): void => {
    if (!connectionSvg) return;
    const start = getPortCenter(portEl);
    if (!start) return;

    clearConnectionDraft();
    connectionDraft = { nodeId, portType, armedByClick: false };
    connectPointerStartX = event.clientX;
    connectPointerStartY = event.clientY;
    connectPointerMoved = false;

    tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tempLine.setAttribute('x1', String(start.x));
    tempLine.setAttribute('y1', String(start.y));
    tempLine.setAttribute('x2', String(start.x));
    tempLine.setAttribute('y2', String(start.y));
    tempLine.setAttribute('stroke', '#23956F');
    tempLine.setAttribute('stroke-width', '2');
    tempLine.setAttribute('stroke-dasharray', '6,3');
    tempLine.setAttribute('opacity', '0.7');
    connectionSvg.appendChild(tempLine);
    highlightConnectionTargets(connectionDraft);
  };

  const addConnectionIfMissing = (
    flow: NonNullable<TranscriptImportState['generatedFlow']>,
    from: string,
    to: string,
    reason: string,
  ): boolean => {
    if (from === to) return false;
    const exists = flow.connections.some((connection) => (
      connection.from === from && connection.to === to
    ));
    if (exists) return false;
    flow.connections.push({
      from,
      to,
      reason: normalizeConnectionReason(reason),
    });
    return true;
  };

  const tryCreateConnectionBetweenPorts = (
    draft: ConnectionDraft,
    targetPort: HTMLElement,
  ): boolean => {
    const flow = state.generatedFlow;
    if (!flow) return false;
    const targetNodeId = targetPort.dataset.portNodeId ?? '';
    if (!targetNodeId) return false;
    const targetPortType = getPortTypeFromElement(targetPort);
    const resolved = resolveConnection(
      draft.nodeId,
      draft.portType,
      targetNodeId,
      targetPortType,
    );
    if (!resolved) return false;

    const added = addConnectionIfMissing(flow, resolved.from, resolved.to, 'Next');
    if (!added) return false;
    state.selectedConnectionIndex = null;
    onFlowMutated();
    return true;
  };

  const tryReassignSelectedConnection = (nodeId: string, portType: PortType): boolean => {
    const flow = state.generatedFlow;
    const edgeIndex = state.selectedConnectionIndex;
    if (!flow || edgeIndex === null || edgeIndex < 0 || edgeIndex >= flow.connections.length) {
      return false;
    }

    const current = flow.connections[edgeIndex];
    const nextFrom = portType === 'out' ? nodeId : current.from;
    const nextTo = portType === 'in' ? nodeId : current.to;
    if (nextFrom === nextTo) return false;

    const duplicate = flow.connections.some((connection, index) => (
      index !== edgeIndex
      && connection.from === nextFrom
      && connection.to === nextTo
    ));
    if (duplicate) return false;

    flow.connections[edgeIndex] = {
      ...current,
      from: nextFrom,
      to: nextTo,
    };
    onFlowMutated();
    return true;
  };

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
    void (async () => {
      const confirmed = await customConfirm(
        'Regenerating will replace the current flow. Any manual edits will be lost. Continue?',
      );
      if (!confirmed) return;
      state.generatedFlow = null;
      state.validationWarnings = [];
      state.nodePositionOverrides = {};
      state.latestRenderedLayout = {};
      state.latestRenderedNodeSizes = {};
      state.generatedPromptMarkdown = '';
      state.promptGenerationMessage = null;
      render();
      onGenerateFlow();
    })();
  });

  const addNodeFromBlock = (
    blockData: FlowBlockData,
    location: { x: number; y: number } | null,
    splitEdgeIndex: number | null,
  ): void => {
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

    if (
      splitEdgeIndex !== null
      && splitEdgeIndex >= 0
      && splitEdgeIndex < flow.connections.length
    ) {
      const edgeToSplit = flow.connections[splitEdgeIndex];
      flow.connections.splice(splitEdgeIndex, 1);
      addConnectionIfMissing(
        flow,
        edgeToSplit.from,
        nodeId,
        edgeToSplit.reason,
      );
      addConnectionIfMissing(flow, nodeId, edgeToSplit.to, 'Next');
      state.selectedConnectionIndex = null;
    }

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
      addNodeFromBlock(blockData, null, null);
    });
  });

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

    const world = clientToWorld(event.clientX, event.clientY);
    if (!world) return;
    const nodeSize = defaultNodeSize();
    const location = {
      x: snapToGrid(world.x - nodeSize.width / 2),
      y: snapToGrid(world.y - nodeSize.height / 2),
    };
    const splitEdgeIndex = resolveEdgeIndexAtClient(event.clientX, event.clientY);
    addNodeFromBlock(blockData, location, splitEdgeIndex);
  });

  container.querySelectorAll<HTMLElement>('[data-flow-edge-hit-index]').forEach((edgeEl) => {
    edgeEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const edgeIndex = parseEdgeIndex(edgeEl.dataset.flowEdgeHitIndex);
      if (edgeIndex === null) return;
      const nextSelected = state.selectedConnectionIndex === edgeIndex ? null : edgeIndex;
      setSelectedConnection(nextSelected);
    });

    edgeEl.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const edgeIndex = parseEdgeIndex(edgeEl.dataset.flowEdgeHitIndex);
      if (edgeIndex === null) return;
      setSelectedConnection(edgeIndex);
      void editConnectionReason(edgeIndex);
    });

    edgeEl.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const edgeIndex = parseEdgeIndex(edgeEl.dataset.flowEdgeHitIndex);
      if (edgeIndex === null) return;
      setSelectedConnection(edgeIndex);
    });
  });

  flowViewport?.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-flow-edge-hit-index],.port,[data-flow-node-id]')) return;
    if (state.selectedConnectionIndex !== null) {
      setSelectedConnection(null);
    }
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
      state.selectedConnectionIndex = null;
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
    portEl.addEventListener('mousedown', (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (!state.generatedFlow) return;
      if (connectionDraft?.armedByClick) return;
      const nodeId = portEl.dataset.portNodeId ?? '';
      if (!nodeId) return;
      const portType = getPortTypeFromElement(portEl);
      beginDragConnectionFromPort(portEl, nodeId, portType, event);
      event.preventDefault();
      event.stopPropagation();
    });

    portEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (suppressNextPortClick) return;
      if (!state.generatedFlow) return;
      const nodeId = portEl.dataset.portNodeId ?? '';
      if (!nodeId) return;
      const portType = getPortTypeFromElement(portEl);

      if (state.selectedConnectionIndex !== null && !connectionDraft) {
        void tryReassignSelectedConnection(nodeId, portType);
        return;
      }

      if (!connectionDraft) {
        armConnectionFromPort(nodeId, portType);
        return;
      }

      if (!connectionDraft.armedByClick) return;
      const isSamePort =
        connectionDraft.nodeId === nodeId
        && connectionDraft.portType === portType;
      if (isSamePort) {
        clearConnectionDraft();
        return;
      }

      const created = tryCreateConnectionBetweenPorts(connectionDraft, portEl);
      if (created) {
        clearConnectionDraft();
        return;
      }

      armConnectionFromPort(nodeId, portType);
    });
  });

  addDocumentListener('mousemove', (event: MouseEvent) => {
    if (!connectionDraft || !tempLine) return;
    if (
      Math.abs(event.clientX - connectPointerStartX) > 3
      || Math.abs(event.clientY - connectPointerStartY) > 3
    ) {
      connectPointerMoved = true;
    }
    const world = clientToWorld(event.clientX, event.clientY);
    if (!world) return;
    tempLine.setAttribute('x2', String(world.x));
    tempLine.setAttribute('y2', String(world.y));
  });

  addDocumentListener('mouseup', (event: MouseEvent) => {
    if (!connectionDraft || !tempLine) return;

    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const targetPort = target?.closest('.port') as HTMLElement | null;
    const created = targetPort ? tryCreateConnectionBetweenPorts(connectionDraft, targetPort) : false;
    const clickWithoutDrag = !connectPointerMoved;

    suppressPortClickOnce();

    if (created) {
      clearConnectionDraft();
      return;
    }

    if (clickWithoutDrag) {
      connectionDraft.armedByClick = true;
      tempLine.remove();
      tempLine = null;
      highlightConnectionTargets(connectionDraft);
      return;
    }

    clearConnectionDraft();
  });

  addDocumentListener('mousedown', (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (connectionDraft?.armedByClick && !target.closest('.port')) {
      clearConnectionDraft();
    }
  });

  addDocumentListener('keydown', (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;
    if (state.selectedConnectionIndex === null) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      deleteSelectedConnection();
      event.preventDefault();
      return;
    }

    if (event.key === 'l' || event.key === 'L') {
      const edgeIndex = state.selectedConnectionIndex;
      if (edgeIndex === null) return;
      void editConnectionReason(edgeIndex);
      event.preventDefault();
    }
  });

  return () => {
    clearConnectionDraft();
    for (const cleanup of documentCleanup) {
      cleanup();
    }
  };
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

function parseEdgeIndex(rawValue: string | undefined): number | null {
  if (typeof rawValue !== 'string') return null;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeConnectionReason(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'Next';
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
