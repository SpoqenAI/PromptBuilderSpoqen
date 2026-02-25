import { router } from '../router';
import { store } from '../store';
import { type PromptNode, uid } from '../models';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { preserveScrollDuringRender } from '../view-state';
import {
  generateTranscriptFlow,
  type TranscriptFlowNode,
  type TranscriptFlowResult,
} from '../transcript-flow';
import { persistTranscriptFlowArtifacts } from '../transcript-artifacts';
import { resolveNodeIcon } from '../node-icons';
import { buildNodeColorStyles, getAutoNodeColor, readNodeColorMeta, withNodeColorMeta } from '../node-colors';

type LayoutPosition = {
  x: number;
  y: number;
};

type LayoutMap = Record<string, LayoutPosition>;
type NodeVisualSize = {
  width: number;
  height: number;
};
type NodeSizeMap = Record<string, NodeVisualSize>;
type FlowRenderState = {
  layout: LayoutMap;
  nodeSizes: NodeSizeMap;
  geometry: { width: number; height: number };
};
type MessageTone = 'info' | 'success' | 'error';

const DEFAULT_PROJECT_NAME = 'Transcript Flow';
const DEFAULT_PROJECT_MODEL = 'GPT-4o';
const MIN_TRANSCRIPT_LENGTH = 20;
const TRANSCRIPT_NODE_MIN_WIDTH = 224;
const TRANSCRIPT_NODE_HEIGHT = 140;
const TRANSCRIPT_NODE_DECORATION_WIDTH = 128;
const TRANSCRIPT_NODE_X_GAP = 300;
const TRANSCRIPT_NODE_Y_GAP = 350;
const GENERATING_THOUGHT_POOL = [
  'Untangling speaker turns and hidden intents...',
  'Negotiating peace between interruptions and edge cases...',
  'Folding small talk into deterministic state machines...',
  'Asking the transcript politely what happened here...',
  'Ranking branches by "would a human do this?" confidence...',
  'Converting "uhh" into production-grade transitions...',
  'Cross-checking every handoff for dropped context...',
  'Simulating awkward silence as a first-class node...',
  'Optimizing loops so callers do not loop forever...',
  'Pinning down escalation paths before they escape...',
  'Teaching the graph to survive Friday-night support traffic...',
  'Adding labels so future-you does not squint at edges...',
] as const;
const GENERATING_THOUGHTS_VISIBLE = 6;
const GENERATING_THOUGHT_STEP_SECONDS = 2;

const nodeLabelMeasureCanvas = document.createElement('canvas');
const nodeLabelMeasureContext = nodeLabelMeasureCanvas.getContext('2d');

export function renderTranscriptImport(container: HTMLElement): void {
  let projectName = DEFAULT_PROJECT_NAME;
  let projectModel = DEFAULT_PROJECT_MODEL;
  interface TranscriptFile {
    id: string;
    name: string;
    content: string;
  }
  let transcripts: TranscriptFile[] = [];
  let assistantName = 'Assistant';
  let userName = 'User';

  let generatedFlow: TranscriptFlowResult | null = null;
  let generationError = '';
  let isGenerating = false;
  let processingProgress: { processed: number; total: number } | null = null;
  let flowRevision = 0;
  let approvedRevision = -1;
  let approvedAt: string | null = null;
  let transcriptSetId: string | null = null;
  let persistenceMessage: { tone: MessageTone; text: string } | null = null;
  let nodePositionOverrides: LayoutMap = {};
  let latestRenderedLayout: LayoutMap = {};
  let latestRenderedNodeSizes: NodeSizeMap = {};
  let suppressNextNodeClick = false;
  let cleanupFlowViewport: (() => void) | null = null;
  let generatingThoughts = buildGeneratingThoughtSequence();

  // Persist viewport state across renders
  let savedZoom: number | null = null;
  let savedPanX: number | null = null;
  let savedPanY: number | null = null;

  function render(): void {
    cleanupFlowViewport?.();
    cleanupFlowViewport = null;

    const canGenerate = transcripts.length > 0 && !isGenerating;
    const flowApproved = isCurrentFlowApproved();
    const flowRenderState = generatedFlow
      ? buildFlowRenderState(generatedFlow, nodePositionOverrides)
      : null;
    latestRenderedLayout = flowRenderState ? cloneLayout(flowRenderState.layout) : {};
    latestRenderedNodeSizes = flowRenderState ? { ...flowRenderState.nodeSizes } : {};

    preserveScrollDuringRender(container, () => {
      container.innerHTML = `
        <header class="ui-header z-20">
          <div class="ui-header-left">
            <button type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer rounded" id="nav-home" aria-label="Go to dashboard">
              <img src="${import.meta.env.BASE_URL}Icon.svg" alt="Spoqen" class="w-8 h-8 object-contain" />
            </button>
            <div class="min-w-0">
              <h1 class="text-sm font-semibold leading-none">Import Transcript (AI)</h1>
              <span class="text-[10px] text-slate-400 uppercase tracking-wider">Generate a hypothetical call-flow diagram</span>
            </div>
          </div>
          <div class="ui-header-center"></div>
          <div class="ui-header-right ui-toolbar">
            ${generatedFlow ? `
              <button id="btn-regenerate-flow" type="button" class="ui-btn ui-btn-outline">
                <span class="material-icons text-sm">refresh</span> Regenerate
              </button>
              <button id="btn-approve-flow" type="button" class="ui-btn border ${flowApproved ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-700 dark:text-emerald-200 dark:bg-emerald-950/30' : 'border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-700 dark:text-amber-200 dark:bg-amber-950/30'} transition-colors">
                <span class="material-icons text-sm">${flowApproved ? 'task_alt' : 'rule'}</span> ${flowApproved ? 'Approved' : 'Approve Flow'}
              </button>
              <button id="btn-create-flow-project" type="button" class="ui-btn ${flowApproved ? 'ui-btn-primary' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300 cursor-not-allowed'}" ${flowApproved ? '' : 'disabled'} title="${flowApproved ? 'Create project from reviewed flow' : 'Approve flow before creating project'}">
                <span class="material-icons text-sm">add_circle</span> Create Project from Flow
              </button>
            ` : ''}
            ${themeToggleHTML()}
            <button id="btn-back" class="ui-btn ui-btn-ghost">
              Back
            </button>
          </div>
        </header>

        <main class="ui-main ui-stack-lg">
          <!-- Sidebar -->
          <aside class="ui-sidebar border-r border-primary/10 bg-white dark:bg-background-dark/50 z-10">
            <div class="ui-scroll p-4 space-y-3 custom-scrollbar" data-scroll-preserve="transcript-import-sidebar">
              <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-100">Transcript Input</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">Upload or paste a transcript. AI converts it into a flow graph.</p>

              <div>
                <label for="transcript-project-name" class="block text-xs font-medium text-slate-500 mb-1">Project name</label>
                <input id="transcript-project-name" value="${esc(projectName)}" class="ui-input" />
              </div>
              <div>
                <label for="transcript-project-model" class="block text-xs font-medium text-slate-500 mb-1">Target model</label>
                <select id="transcript-project-model" class="ui-select">
                  ${renderModelOptions(projectModel)}
                </select>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label for="transcript-assistant-name" class="block text-xs font-medium text-slate-500 mb-1">Assistant label</label>
                  <input id="transcript-assistant-name" value="${esc(assistantName)}" class="ui-input" placeholder="Assistant" />
                </div>
                <div>
                  <label for="transcript-user-name" class="block text-xs font-medium text-slate-500 mb-1">User label</label>
                  <input id="transcript-user-name" value="${esc(userName)}" class="ui-input" placeholder="User" />
                </div>
              </div>
              <div>
                <div class="flex items-center justify-between gap-2 mb-1">
                  <label class="text-xs font-medium text-slate-500">Transcript Corpus</label>
                  <span id="transcript-corpus-count" class="text-[11px] text-slate-400">${transcripts.length} files</span>
                </div>
                
                <div id="transcript-drop-zone" class="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-4 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer">
                  <div class="flex flex-col items-center gap-2 pointer-events-none">
                    <span class="material-icons text-slate-400">cloud_upload</span>
                    <p class="text-[11px] text-slate-500">Drag & drop files here, or <span class="text-primary cursor-pointer hover:underline pointer-events-auto" id="btn-upload-transcript">browse</span></p>
                    <p class="text-[9px] text-slate-400">Supports .txt, .srt, .vtt, .csv (up to 100 files)</p>
                  </div>
                  <input id="transcript-file" type="file" multiple accept=".txt,.md,.log,.json,.csv,.srt,.vtt" class="hidden" />
                </div>

                ${transcripts.length > 0 ? `
                  <div class="mt-3 max-h-48 overflow-y-auto custom-scrollbar space-y-1 pr-1" id="transcript-list">
                    ${transcripts.map(t => `
                      <div class="flex items-center justify-between gap-2 p-2 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                        <div class="min-w-0 flex-1">
                          <p class="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate" title="${esc(t.name)}">${esc(t.name)}</p>
                          <p class="text-[9px] text-slate-400">${(t.content.length / 1024).toFixed(1)} KB</p>
                        </div>
                        <button type="button" class="text-slate-400 hover:text-red-500 transition-colors p-1" data-remove-transcript="${esc(t.id)}">
                          <span class="material-icons text-[14px]">close</span>
                        </button>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              </div>

              ${generationError ? `<p id="transcript-generate-error" class="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-200">${esc(generationError)}</p>` : ''}
              ${persistenceMessage ? `<p class="rounded-lg border px-3 py-2 text-xs ${messageClass(persistenceMessage.tone)}">${esc(persistenceMessage.text)}</p>` : ''}

              <div class="flex flex-wrap gap-2 pt-1">
                <button id="btn-generate-flow" class="flex-1 ui-btn ui-btn-primary !text-sm !py-2 disabled:opacity-50 disabled:cursor-not-allowed" ${canGenerate ? '' : 'disabled'}>
                  ${isGenerating ? (processingProgress ? `Generating (${processingProgress.processed}/${processingProgress.total})...` : 'Generating...') : 'Generate Flow'}
                </button>
                <button id="btn-clear-transcript" type="button" class="ui-btn ui-btn-ghost !text-sm !py-2">
                  Clear
                </button>
              </div>

              ${generatedFlow ? `<p class="text-[11px] ${flowApproved ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}">${flowApproved ? `Approved at ${formatIsoDate(approvedAt)}. You can create a project now.` : 'Review the generated flow and click Approve Flow before creating a project.'}</p>` : ''}
            </div>
            <div class="p-4 border-t border-primary/5 bg-slate-50 dark:bg-white/5">
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full ${generatedFlow ? 'bg-primary animate-pulse' : 'bg-slate-300'}"></div>
                <span class="text-[10px] font-medium text-slate-500 uppercase">${generatedFlow ? `${generatedFlow.nodes.length} Nodes · ${generatedFlow.connections.length} Connections` : 'No flow generated'}</span>
              </div>
            </div>
          </aside>

          <!-- Main Canvas Area -->
          <div class="ui-pane flex-1 relative overflow-hidden bg-background-light dark:bg-background-dark canvas-grid">
            ${generatedFlow
          ? renderFlowCanvas(generatedFlow, flowApproved, isGenerating, flowRenderState as FlowRenderState)
          : renderEmptyCanvas(isGenerating, generatingThoughts)}
            ${isGenerating && generatedFlow ? renderGeneratingOverlay(generatingThoughts) : ''}
          </div>
        </main>
      `;
    });

    wireThemeToggle(container);
    wireEvents();
    wireFlowViewport();
  }

  function wireFlowViewport(): void {
    const viewport = container.querySelector<HTMLElement>('#flow-viewport');
    const world = container.querySelector<HTMLElement>('#flow-world');
    if (!viewport || !world) return;

    const MIN_ZOOM = 0.4;
    const MAX_ZOOM = 2.5;
    let zoom: number;
    let panX: number;
    let panY: number;
    const liveLayout = cloneLayout(latestRenderedLayout);

    if (savedZoom !== null && savedPanX !== null && savedPanY !== null) {
      // Restore previous viewport position
      zoom = savedZoom;
      panX = savedPanX;
      panY = savedPanY;
    } else {
      // Fit the flow into the viewport on first render
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const ww = parseFloat(world.style.width) || 760;
      const wh = parseFloat(world.style.height) || 420;
      const fitScale = Math.min(vw / ww, vh / wh, 1);
      zoom = Math.max(MIN_ZOOM, Math.min(fitScale * 0.85, MAX_ZOOM));
      panX = Math.max(20, (vw - ww * zoom) / 2);
      panY = Math.max(40, (vh - wh * zoom) / 2);
    }

    function applyTransform(): void {
      world!.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      // Persist for next render
      savedZoom = zoom;
      savedPanX = panX;
      savedPanY = panY;
    }
    applyTransform();

    const svg = world.querySelector<SVGSVGElement>('#flow-connections-svg');

    const updateEdgeGeometry = (): void => {
      world.querySelectorAll<SVGGElement>('[data-flow-edge]').forEach((edgeEl) => {
        const fromId = edgeEl.dataset.fromId ?? '';
        const toId = edgeEl.dataset.toId ?? '';
        const from = liveLayout[fromId];
        const to = liveLayout[toId];
        if (!from || !to) return;

        const fromSize = latestRenderedNodeSizes[fromId] ?? defaultNodeSize();
        const toSize = latestRenderedNodeSizes[toId] ?? defaultNodeSize();
        const geometry = edgeGeometry(from, fromSize, to, toSize);

        const pathEl = edgeEl.querySelector<SVGPathElement>('[data-flow-edge-path]');
        if (pathEl) pathEl.setAttribute('d', geometry.curve);

        const fromDot = edgeEl.querySelector<SVGCircleElement>('[data-flow-edge-from-dot]');
        if (fromDot) {
          fromDot.setAttribute('cx', String(geometry.fromX));
          fromDot.setAttribute('cy', String(geometry.fromY));
        }

        const toDot = edgeEl.querySelector<SVGCircleElement>('[data-flow-edge-to-dot]');
        if (toDot) {
          toDot.setAttribute('cx', String(geometry.toX));
          toDot.setAttribute('cy', String(geometry.toY));
        }

        const motion = edgeEl.querySelector<SVGAnimateMotionElement>('[data-flow-edge-motion]');
        if (motion) motion.setAttribute('path', geometry.curve);
      });
    };

    const updateWorldGeometry = (): void => {
      const geometry = computeCanvasGeometry(liveLayout, latestRenderedNodeSizes);
      world.style.width = `${geometry.width}px`;
      world.style.height = `${geometry.height}px`;
      if (svg) {
        svg.setAttribute('width', String(geometry.width));
        svg.setAttribute('height', String(geometry.height));
        svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
      }
    };

    // Right-click drag panning (matches Canvas view exactly)
    let isPanning = false;
    let panStartMouseX = 0;
    let panStartMouseY = 0;
    let panStartX = 0;
    let panStartY = 0;
    let isDraggingNode = false;
    let activeDragNodeId: string | null = null;
    let activeDragNodeEl: HTMLElement | null = null;
    let dragStartMouseX = 0;
    let dragStartMouseY = 0;
    let dragStartNodeX = 0;
    let dragStartNodeY = 0;
    let dragMoved = false;

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    const onViewportMouseDown = (e: MouseEvent): void => {
      if (e.button !== 2) return;
      if (isDraggingNode) return;
      isPanning = true;
      panStartMouseX = e.clientX;
      panStartMouseY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      viewport.classList.add('cursor-grabbing');
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent): void => {
      if (isDraggingNode && activeDragNodeId && activeDragNodeEl) {
        const deltaX = (e.clientX - dragStartMouseX) / zoom;
        const deltaY = (e.clientY - dragStartMouseY) / zoom;
        const nextX = Math.round((dragStartNodeX + deltaX) / 20) * 20;
        const nextY = Math.round((dragStartNodeY + deltaY) / 20) * 20;

        if (Math.abs(nextX - dragStartNodeX) > 1 || Math.abs(nextY - dragStartNodeY) > 1) {
          dragMoved = true;
        }

        liveLayout[activeDragNodeId] = { x: nextX, y: nextY };
        nodePositionOverrides[activeDragNodeId] = { x: nextX, y: nextY };
        activeDragNodeEl.style.left = `${nextX}px`;
        activeDragNodeEl.style.top = `${nextY}px`;
        updateWorldGeometry();
        updateEdgeGeometry();
        return;
      }

      if (!isPanning) return;
      panX = panStartX + (e.clientX - panStartMouseX);
      panY = panStartY + (e.clientY - panStartMouseY);
      applyTransform();
    };

    const onMouseUp = (): void => {
      if (isDraggingNode) {
        isDraggingNode = false;
        if (dragMoved) {
          suppressNextNodeClick = true;
          setTimeout(() => {
            suppressNextNodeClick = false;
          }, 0);
          render();
        }
        viewport.classList.remove('cursor-grabbing');
        activeDragNodeId = null;
        activeDragNodeEl = null;
        return;
      }

      if (!isPanning) return;
      isPanning = false;
      viewport.classList.remove('cursor-grabbing');
    };

    const nodeDragCleanup: Array<() => void> = [];
    container.querySelectorAll<HTMLElement>('[data-flow-node-id]').forEach((nodeEl) => {
      const handle = nodeEl.querySelector<HTMLElement>('.node-header') ?? nodeEl;
      const onNodeMouseDown = (e: MouseEvent): void => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('button,input,select,textarea,a')) return;
        const nodeId = nodeEl.dataset.flowNodeId;
        if (!nodeId) return;

        const startPosition = liveLayout[nodeId] ?? latestRenderedLayout[nodeId];
        if (!startPosition) return;

        isDraggingNode = true;
        activeDragNodeId = nodeId;
        activeDragNodeEl = nodeEl;
        dragStartMouseX = e.clientX;
        dragStartMouseY = e.clientY;
        dragStartNodeX = startPosition.x;
        dragStartNodeY = startPosition.y;
        dragMoved = false;
        viewport.classList.add('cursor-grabbing');
        e.preventDefault();
        e.stopPropagation();
      };

      handle.addEventListener('mousedown', onNodeMouseDown);
      nodeDragCleanup.push(() => {
        handle.removeEventListener('mousedown', onNodeMouseDown);
      });
    });

    viewport.addEventListener('contextmenu', onContextMenu);
    viewport.addEventListener('mousedown', onViewportMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Scroll-wheel zoom around cursor (matches Canvas view exactly)
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const focalX = e.clientX - rect.left;
      const focalY = e.clientY - rect.top;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
      const sensitivity = e.ctrlKey ? 0.0025 : 0.0012;
      const next = Math.max(MIN_ZOOM, Math.min(zoom * Math.exp(-delta * sensitivity), MAX_ZOOM));
      if (next === zoom) return;
      const wx = (focalX - panX) / zoom;
      const wy = (focalY - panY) / zoom;
      panX = focalX - wx * next;
      panY = focalY - wy * next;
      zoom = next;
      applyTransform();
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });

    cleanupFlowViewport = () => {
      viewport.removeEventListener('contextmenu', onContextMenu);
      viewport.removeEventListener('mousedown', onViewportMouseDown);
      viewport.removeEventListener('wheel', onWheel);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      nodeDragCleanup.forEach((cleanup) => cleanup());
    };
  }

  function wireEvents(): void {
    container.querySelector<HTMLButtonElement>('#nav-home')?.addEventListener('click', () => {
      cleanupFlowViewport?.();
      cleanupFlowViewport = null;
      router.navigate('/');
    });

    container.querySelector<HTMLButtonElement>('#btn-back')?.addEventListener('click', () => {
      cleanupFlowViewport?.();
      cleanupFlowViewport = null;
      router.navigate('/import');
    });

    const projectNameInput = container.querySelector<HTMLInputElement>('#transcript-project-name');
    projectNameInput?.addEventListener('input', () => {
      projectName = projectNameInput.value;
    });

    const projectModelSelect = container.querySelector<HTMLSelectElement>('#transcript-project-model');
    projectModelSelect?.addEventListener('change', () => {
      projectModel = projectModelSelect.value;
    });

    const assistantNameInput = container.querySelector<HTMLInputElement>('#transcript-assistant-name');
    assistantNameInput?.addEventListener('input', () => {
      assistantName = assistantNameInput.value;
    });

    const userNameInput = container.querySelector<HTMLInputElement>('#transcript-user-name');
    userNameInput?.addEventListener('input', () => {
      userName = userNameInput.value;
    });

    const dropZone = container.querySelector<HTMLElement>('#transcript-drop-zone');
    const fileInput = container.querySelector<HTMLInputElement>('#transcript-file');

    container.querySelector<HTMLElement>('#btn-upload-transcript')?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });

    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-primary', 'bg-primary/5');
    });

    dropZone?.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-primary', 'bg-primary/5');
    });

    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-primary', 'bg-primary/5');
      if (e.dataTransfer?.files) {
        handleFiles(Array.from(e.dataTransfer.files));
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
        reader.onload = (e) => {
          const content = e.target?.result as string;
          transcripts.push({
            id: uid(),
            name: file.name,
            content: normalizeLineEndings(content)
          });
          processed++;
          if (processed === files.length) {
            generationError = '';
            persistenceMessage = null;
            clearFlowApproval();
            render();
          }
        };
        reader.readAsText(file);
      }
    }

    container.querySelectorAll<HTMLButtonElement>('[data-remove-transcript]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.removeTranscript;
        transcripts = transcripts.filter(t => t.id !== id);
        render();
      });
    });

    container.querySelector<HTMLButtonElement>('#btn-clear-transcript')?.addEventListener('click', () => {
      transcripts = [];
      generationError = '';
      processingProgress = null;
      generatedFlow = null;
      nodePositionOverrides = {};
      latestRenderedLayout = {};
      latestRenderedNodeSizes = {};
      flowRevision = 0;
      approvedRevision = -1;
      approvedAt = null;
      transcriptSetId = null;
      persistenceMessage = null;
      savedZoom = null;
      savedPanX = null;
      savedPanY = null;
      render();
    });

    container.querySelector<HTMLButtonElement>('#btn-generate-flow')?.addEventListener('click', () => {
      void generateFlow();
    });

    container.querySelector<HTMLButtonElement>('#btn-create-flow-project')?.addEventListener('click', () => {
      createProjectFromGeneratedFlow();
    });

    container.querySelector<HTMLButtonElement>('#btn-approve-flow')?.addEventListener('click', () => {
      if (!generatedFlow) return;
      approvedRevision = flowRevision;
      approvedAt = new Date().toISOString();
      generationError = '';
      render();
    });

    container.querySelector<HTMLButtonElement>('#btn-regenerate-flow')?.addEventListener('click', () => {
      void generateFlow();
    });

    // Wire clickable nodes — open editable modal
    container.querySelectorAll<HTMLElement>('[data-flow-node-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (suppressNextNodeClick) return;
        e.stopPropagation();
        const nodeId = el.dataset.flowNodeId ?? null;
        if (!nodeId || !generatedFlow) return;
        const node = generatedFlow.nodes.find((n) => n.id === nodeId);
        if (node) openNodeEditorModal(node);
      });
    });

    // Click canvas background to deselect
    container.querySelector<HTMLElement>('#flow-viewport')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'flow-viewport' || (e.target as HTMLElement).closest('svg')) {
        // no-op, modal handles its own close now
      }
    });
  }

  async function generateFlow(): Promise<void> {
    if (isGenerating) return;

    if (transcripts.length === 0) {
      generationError = 'Please upload at least one transcript.';
      render();
      return;
    }

    isGenerating = true;
    generatingThoughts = buildGeneratingThoughtSequence();
    generationError = '';
    persistenceMessage = null;
    processingProgress = null;
    render();

    try {
      const flow = await generateTranscriptFlow({
        transcripts: transcripts.map(t => t.content),
        assistantName: assistantName.trim() || undefined,
        userName: userName.trim() || undefined,
        onProgress: (processed, total) => {
          processingProgress = { processed, total };
          render();
        }
      });

      generatedFlow = flow;
      nodePositionOverrides = {};
      latestRenderedLayout = {};
      latestRenderedNodeSizes = {};
      savedZoom = null;
      savedPanX = null;
      savedPanY = null;
      flowRevision += 1;
      clearFlowApproval();

      if (projectName.trim().length === 0 || projectName === DEFAULT_PROJECT_NAME) {
        projectName = flow.title;
      }

      try {
        const persisted = await persistTranscriptFlowArtifacts({
          transcript: transcripts.map(t => t.content).join('\\n\\n---\\n\\n'),
          flow,
          projectName: projectName.trim() || flow.title || DEFAULT_PROJECT_NAME,
          transcriptSetId,
          metadata: {
            assistantName: assistantName.trim() || 'Assistant',
            userName: userName.trim() || 'User',
            projectModel,
            nodeCountStrategy: 'ai-decides',
            transcriptCount: transcripts.length,
          },
        });
        transcriptSetId = persisted.transcriptSetId;
        store.registerTranscriptFlowDraft(
          persisted.transcriptSetId,
          flow,
          persisted.transcriptFlowId,
          projectName.trim() || flow.title || DEFAULT_PROJECT_NAME,
        );
        persistenceMessage = {
          tone: 'success',
          text: `Saved transcript artifacts (set ${shortId(persisted.transcriptSetId)}, flow ${shortId(persisted.transcriptFlowId)}).`,
        };
      } catch (persistErr) {
        persistenceMessage = {
          tone: 'error',
          text: persistErr instanceof Error ? persistErr.message : 'Failed to persist transcript artifacts.',
        };
      }
    } catch (err) {
      generationError = err instanceof Error ? err.message : 'Failed to generate flow from transcript.';
    } finally {
      isGenerating = false;
      render();
    }
  }

  function syncTranscriptControls(): void {
    const corpusCount = container.querySelector<HTMLElement>('#transcript-corpus-count');
    if (corpusCount) {
      corpusCount.textContent = `${transcripts.length} files`;
    }

    const generateButton = container.querySelector<HTMLButtonElement>('#btn-generate-flow');
    if (generateButton) {
      generateButton.disabled = transcripts.length === 0 || isGenerating;
    }
  }

  function createProjectFromGeneratedFlow(): void {
    if (!generatedFlow) return;
    if (!isCurrentFlowApproved()) {
      generationError = 'Review and approve the generated flow before creating a project.';
      render();
      return;
    }

    const normalizedProjectName = projectName.trim() || generatedFlow.title || DEFAULT_PROJECT_NAME;
    const project = store.createProject(
      normalizedProjectName,
      generatedFlow.summary,
      projectModel,
    );

    const layout = buildFlowRenderState(generatedFlow, nodePositionOverrides).layout;
    const nodeIdMap = new Map<string, string>();

    for (const [index, generatedNode] of generatedFlow.nodes.entries()) {
      const position = layout[generatedNode.id] ?? { x: 80, y: 80 };
      const seededColor = readNodeColorMeta(generatedNode.meta) ?? getAutoNodeColor(index);
      const promptNode: PromptNode = {
        id: uid(),
        type: generatedNode.type,
        label: generatedNode.label,
        icon: resolveNodeIcon(generatedNode.icon, generatedNode.type),
        x: position.x,
        y: position.y,
        content: generatedNode.content,
        meta: withNodeColorMeta(generatedNode.meta, seededColor),
      };

      store.addNode(project.id, promptNode);
      nodeIdMap.set(generatedNode.id, promptNode.id);
    }

    for (const connection of generatedFlow.connections) {
      const from = nodeIdMap.get(connection.from);
      const to = nodeIdMap.get(connection.to);
      if (!from || !to || from === to) continue;
      store.addConnection(project.id, from, to, connection.reason);
    }

    store.saveAssembledVersion(project.id, 'Initial transcript flow import');
    if (transcriptSetId) {
      store.linkTranscriptSetToProject(transcriptSetId, project.id, generatedFlow);
    }
    cleanupFlowViewport?.();
    cleanupFlowViewport = null;
    router.navigate(`/project/${project.id}`);
  }

  function isCurrentFlowApproved(): boolean {
    return generatedFlow !== null && approvedRevision === flowRevision;
  }

  function clearFlowApproval(): void {
    approvedRevision = -1;
    approvedAt = null;
  }

  function openNodeEditorModal(node: TranscriptFlowNode): void {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200';

    const dialog = document.createElement('div');
    dialog.className = 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-xl p-0 animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]';

    const safeIcon = resolveNodeIcon(node.icon, node.type);

    dialog.innerHTML = `
      <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <div class="flex items-center gap-2 min-w-0">
          <span class="material-icons text-base text-primary shrink-0">${safeIcon}</span>
          <span class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">Edit Node</span>
        </div>
        <button id="modal-close-btn" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer" title="Close">
          <span class="material-icons text-lg">close</span>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
        <div>
          <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Label</label>
          <input id="node-edit-label" type="text" value="${esc(node.label)}" class="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-primary/50 focus:outline-none text-sm text-zinc-900 dark:text-zinc-100" />
        </div>
        <div>
          <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Type</label>
          <input id="node-edit-type" type="text" value="${esc(node.type)}" class="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-600 dark:text-zinc-400" />
        </div>
        <div>
          <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Content</label>
          <textarea id="node-edit-content" rows="12" class="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono text-xs leading-relaxed focus:ring-2 focus:ring-primary/50 focus:outline-none text-zinc-900 dark:text-zinc-100 custom-scrollbar resize-y">${esc(node.content)}</textarea>
        </div>
        ${Object.keys(node.meta).length > 0 ? `
        <div>
          <span class="block text-[9px] uppercase tracking-wider text-zinc-400 mb-1">Metadata</span>
          ${Object.entries(node.meta).map(([k, v]) => `<div class="text-[11px] text-zinc-500"><span class="font-medium">${esc(k)}:</span> ${esc(v)}</div>`).join('')}
        </div>
        ` : ''}
      </div>
      <div class="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800">
        <button id="modal-cancel-btn" class="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm">Cancel</button>
        <button id="modal-save-btn" class="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors text-sm">Save Changes</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const labelInput = dialog.querySelector<HTMLInputElement>('#node-edit-label')!;
    const contentArea = dialog.querySelector<HTMLTextAreaElement>('#node-edit-content')!;
    const typeInput = dialog.querySelector<HTMLInputElement>('#node-edit-type')!;

    labelInput.focus({ preventScroll: true });
    labelInput.select();

    const cleanup = () => {
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', handleKeyDown);
    };

    const save = () => {
      node.label = labelInput.value.trim() || node.label;
      node.content = contentArea.value;
      node.type = (typeInput.value.trim() || node.type) as typeof node.type;
      flowRevision += 1;
      clearFlowApproval();
      cleanup();
      render();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };

    dialog.querySelector('#modal-close-btn')!.addEventListener('click', cleanup);
    dialog.querySelector('#modal-cancel-btn')!.addEventListener('click', cleanup);
    dialog.querySelector('#modal-save-btn')!.addEventListener('click', save);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup();
    });
    document.addEventListener('keydown', handleKeyDown);
  }

  render();
}

function renderEmptyCanvas(isGenerating: boolean, generatingThoughts: string[]): string {
  const previewTitle = isGenerating ? 'Generating Flow...' : 'Flow Preview';
  const previewBody = isGenerating
    ? 'AI is analyzing the transcript and building your call flow.'
    : 'Generate a flow to see the graph here';
  const icon = isGenerating ? 'auto_awesome' : 'account_tree';

  return `
    <div class="flex flex-col items-center justify-center h-full">
      <div class="relative group">
        <div class="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity"></div>
        <div class="relative w-48 bg-white dark:bg-slate-900 border-2 border-primary rounded-xl p-4 shadow-xl flex flex-col items-center gap-3">
          <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <span class="material-icons text-primary ${isGenerating ? 'animate-pulse' : ''}">${icon}</span>
          </div>
          <div class="text-center">
            <h2 class="text-sm font-bold">${previewTitle}</h2>
            <p class="text-[10px] text-slate-400">${previewBody}</p>
            ${isGenerating ? `
              <div class="mt-3 flex justify-center" aria-hidden="true">
                <span class="relative inline-flex h-14 w-14 items-center justify-center">
                  <span class="absolute inset-0 rounded-full border-2 border-primary/25"></span>
                  <span class="absolute inset-1 rounded-full border-2 border-primary border-t-transparent animate-spin"></span>
                  <span class="absolute h-2.5 w-2.5 rounded-full bg-primary/80 animate-pulse"></span>
                </span>
              </div>
              ${renderThinkingMessages(generatingThoughts)}
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFlowCanvas(
  flow: TranscriptFlowResult,
  isApproved: boolean,
  isGenerating: boolean,
  flowRenderState: FlowRenderState,
): string {
  const { layout, nodeSizes, geometry } = flowRenderState;

  const edges = flow.connections
    .map((connection, index) => {
      const from = layout[connection.from];
      const to = layout[connection.to];
      if (!from || !to) return '';

      const fromSize = nodeSizes[connection.from] ?? defaultNodeSize();
      const toSize = nodeSizes[connection.to] ?? defaultNodeSize();
      const geometryData = edgeGeometry(from, fromSize, to, toSize);

      return `
        <g data-flow-edge="${index}" data-from-id="${esc(connection.from)}" data-to-id="${esc(connection.to)}">
          <path data-flow-edge-path="1" d="${geometryData.curve}" stroke="#23956F" stroke-width="2" fill="none" class="connector-path" />
          <circle data-flow-edge-from-dot="1" cx="${geometryData.fromX}" cy="${geometryData.fromY}" r="5" fill="#23956F" />
          <circle data-flow-edge-to-dot="1" cx="${geometryData.toX}" cy="${geometryData.toY}" r="5" fill="#23956F" />
          <circle r="3" fill="#23956F" opacity="0.7">
            <animateMotion data-flow-edge-motion="1" dur="3s" repeatCount="indefinite" path="${geometryData.curve}" />
          </circle>
        </g>
      `;
    })
    .join('');

  const nodes = flow.nodes
    .map((node, index) => {
      const position = layout[node.id] ?? { x: 80, y: 80 };
      const safeIcon = resolveNodeIcon(node.icon, node.type);
      const displayLabel = node.label.trim().length > 0 ? node.label.trim() : `Step ${shortId(node.id)}`;
      const contentPreview = esc(trimForPreview(node.content, 120));
      const nodeSize = nodeSizes[node.id] ?? defaultNodeSize();
      const nodeColor = readNodeColorMeta(node.meta) ?? getAutoNodeColor(index);
      const styles = buildNodeColorStyles(nodeColor);

      return `
        <div class="canvas-node pointer-events-auto bg-white dark:bg-slate-900 border rounded-lg shadow-xl node-glow cursor-pointer"
             data-flow-node-id="${esc(node.id)}"
             style="left:${position.x}px; top:${position.y}px; width:${nodeSize.width}px; border-color:${styles.border};">
          <div class="node-header p-3 flex items-center justify-between rounded-t-lg cursor-move" style="background:${styles.headerBackground}; border-bottom:1px solid ${styles.headerBorder};">
            <h2 class="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 select-none min-w-0">
              <span class="material-icons text-sm shrink-0 w-4 overflow-hidden text-center" style="color:${styles.icon};">${safeIcon}</span>
              <span class="block truncate" title="${esc(displayLabel)}">${esc(displayLabel)}</span>
            </h2>
          </div>
          <div class="relative">
            <div class="p-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono leading-relaxed max-h-24 overflow-hidden">
              ${contentPreview}
            </div>
          </div>
          <div class="bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 flex justify-end items-center rounded-b-lg border-t" style="border-top-color:${styles.footerBorder};">
            <span class="text-[9px] font-mono" style="color:${styles.tokenText};">${node.content.length > 0 ? Math.ceil(node.content.length / 4) + ' tok' : 'empty'}</span>
          </div>
        </div>
      `;
    })
    .join('');

  // Detail panel is now a full-screen modal — see openNodeEditorModal()
  const detailPanel = '';

  const infoBar = `
    <div class="absolute top-4 left-4 right-4 sm:right-auto sm:max-w-[min(90vw,60rem)] flex items-center gap-2 overflow-x-auto whitespace-nowrap custom-scrollbar text-xs font-medium text-slate-400 bg-white/80 dark:bg-background-dark/80 px-3 py-1.5 rounded-full border border-primary/10 shadow-sm z-10">
      <span class="text-slate-800 dark:text-slate-200">${esc(flow.title)}</span>
      <span class="text-[10px]">|</span>
      <span>${esc(flow.model)}</span>
      <span class="text-[10px]">·</span>
      <span>${flow.nodes.length} nodes</span>
      <span class="text-[10px]">·</span>
      <span>${flow.connections.length} connections</span>
      <span class="text-[10px]">|</span>
      <span class="${isApproved ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}">${isApproved ? 'approved' : 'pending approval'}</span>
      ${isGenerating ? `
        <span class="text-[10px]">|</span>
        <span class="inline-flex items-center gap-1 text-primary">
          <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          generating
        </span>
      ` : ''}
    </div>
  `;

  const fallbackBanner = flow.usedFallback
    ? `<div class="absolute bottom-4 left-4 right-4 sm:right-auto sm:max-w-[min(90vw,36rem)] rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-200 z-10">${esc(flow.warning ?? 'AI unavailable, using deterministic fallback.')}</div>`
    : '';

  return `
    ${infoBar}
    ${fallbackBanner}
    ${detailPanel}
    <div id="flow-viewport" class="absolute inset-0 overflow-hidden">
      <div id="flow-world" style="transform-origin:0 0; position:absolute; width:${geometry.width}px; height:${geometry.height}px;">
        <svg id="flow-connections-svg" class="absolute inset-0 pointer-events-none z-[1]" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          ${edges}
        </svg>
        <div class="absolute inset-0 z-[2] pointer-events-none">
          ${nodes}
        </div>
      </div>
    </div>
  `;
}

function renderGeneratingOverlay(generatingThoughts: string[]): string {
  return `
    <div class="absolute inset-0 z-30 pointer-events-none">
      <div class="absolute inset-0 bg-white/28 dark:bg-slate-950/38 backdrop-blur-[1px]"></div>
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="w-[22rem] max-w-full rounded-xl border border-primary/25 bg-white/92 dark:bg-slate-900/92 shadow-xl px-4 py-4">
          <div class="flex flex-col items-center gap-2 text-center">
            <span class="relative inline-flex h-14 w-14 items-center justify-center">
              <span class="absolute inset-0 rounded-full border-2 border-primary/25"></span>
              <span class="absolute inset-1 rounded-full border-2 border-primary border-t-transparent animate-spin"></span>
              <span class="absolute h-2.5 w-2.5 rounded-full bg-primary/80 animate-pulse"></span>
            </span>
            <div class="text-xs text-slate-700 dark:text-slate-200">
              <div class="font-semibold">Generating flow...</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">AI is updating your graph from the transcript.</div>
            </div>
            ${renderThinkingMessages(generatingThoughts)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderThinkingMessages(messages: string[]): string {
  const selected = messages.length > 0 ? messages : ['Analyzing transcript...'];
  const durationSeconds = Math.max(selected.length * GENERATING_THOUGHT_STEP_SECONDS, 2);
  return `
    <div class="thinking-message-stack mt-2 h-5 w-full max-w-[320px]" style="--thinking-duration:${durationSeconds}s">
      ${selected.map((message, index) => `
        <p
          class="thinking-message absolute inset-0 text-center text-[11px] text-slate-500 dark:text-slate-400 font-mono"
          style="animation-delay:${index * GENERATING_THOUGHT_STEP_SECONDS}s"
        >${esc(message)}</p>
      `).join('')}
    </div>
  `;
}

function buildGeneratingThoughtSequence(): string[] {
  const pool = [...GENERATING_THOUGHT_POOL];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, Math.min(GENERATING_THOUGHTS_VISIBLE, pool.length));
}

function buildFlowRenderState(flow: TranscriptFlowResult, overrides: LayoutMap): FlowRenderState {
  const nodeSizes = computeNodeVisualSizes(flow);
  const autoLayout = computeFlowLayout(flow, nodeSizes);
  const layout = cloneLayout(autoLayout);

  for (const node of flow.nodes) {
    const override = overrides[node.id];
    if (!override) continue;
    layout[node.id] = { x: override.x, y: override.y };
  }

  return {
    layout,
    nodeSizes,
    geometry: computeCanvasGeometry(layout, nodeSizes),
  };
}

function cloneLayout(layout: LayoutMap): LayoutMap {
  const cloned: LayoutMap = {};
  for (const [nodeId, position] of Object.entries(layout)) {
    cloned[nodeId] = { x: position.x, y: position.y };
  }
  return cloned;
}

function defaultNodeSize(): NodeVisualSize {
  return {
    width: TRANSCRIPT_NODE_MIN_WIDTH,
    height: TRANSCRIPT_NODE_HEIGHT,
  };
}

function computeNodeVisualSizes(flow: TranscriptFlowResult): NodeSizeMap {
  const sizes: NodeSizeMap = {};
  for (const node of flow.nodes) {
    const label = node.label.trim().length > 0 ? node.label.trim() : `Step ${shortId(node.id)}`;
    sizes[node.id] = {
      width: Math.max(TRANSCRIPT_NODE_MIN_WIDTH, estimateTranscriptNodeLabelWidth(label) + TRANSCRIPT_NODE_DECORATION_WIDTH),
      height: TRANSCRIPT_NODE_HEIGHT,
    };
  }
  return sizes;
}

function estimateTranscriptNodeLabelWidth(label: string): number {
  const text = label.trim().length > 0 ? label.trim() : 'Node';
  if (!nodeLabelMeasureContext) return text.length * 7;
  nodeLabelMeasureContext.font = '700 12px system-ui, -apple-system, sans-serif';
  return Math.ceil(nodeLabelMeasureContext.measureText(text).width);
}

function computeCanvasGeometry(layout: LayoutMap, nodeSizes: NodeSizeMap): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;

  for (const [nodeId, position] of Object.entries(layout)) {
    const nodeSize = nodeSizes[nodeId] ?? defaultNodeSize();
    maxX = Math.max(maxX, position.x + nodeSize.width);
    maxY = Math.max(maxY, position.y + nodeSize.height);
  }

  return {
    width: Math.max(maxX + 120, 760),
    height: Math.max(maxY + 120, 420),
  };
}

function computeFlowLayout(flow: TranscriptFlowResult, nodeSizes: NodeSizeMap): LayoutMap {
  const levelByNode = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const incomingCounts = new Map<string, number>();

  for (const node of flow.nodes) {
    incomingCounts.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const connection of flow.connections) {
    if (!incomingCounts.has(connection.to) || !outgoing.has(connection.from)) continue;
    outgoing.get(connection.from)?.push(connection.to);
    incomingCounts.set(connection.to, (incomingCounts.get(connection.to) ?? 0) + 1);
  }

  const sourceIds = flow.nodes
    .filter((node) => (incomingCounts.get(node.id) ?? 0) === 0)
    .map((node) => node.id);

  const queue = sourceIds.length > 0 ? [...sourceIds] : [flow.nodes[0]?.id].filter((id): id is string => Boolean(id));
  for (const sourceId of queue) {
    levelByNode.set(sourceId, 0);
  }

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;

    const currentLevel = levelByNode.get(currentId) ?? 0;
    const targets = outgoing.get(currentId) ?? [];
    for (const targetId of targets) {
      if (!levelByNode.has(targetId)) {
        levelByNode.set(targetId, currentLevel + 1);
        queue.push(targetId);
      }
    }
  }

  const fallbackLevel = levelByNode.size > 0
    ? Math.max(...Array.from(levelByNode.values()))
    : 0;

  flow.nodes.forEach((node) => {
    if (!levelByNode.has(node.id)) {
      levelByNode.set(node.id, fallbackLevel);
    }
  });

  const groups = new Map<number, TranscriptFlowNode[]>();
  for (const node of flow.nodes) {
    const level = levelByNode.get(node.id) ?? 0;
    const group = groups.get(level) ?? [];
    group.push(node);
    groups.set(level, group);
  }

  const levels = Array.from(groups.keys()).sort((left, right) => left - right);
  const layout: LayoutMap = {};

  const startX = 60;
  const startY = 50;
  const ySpacing = TRANSCRIPT_NODE_Y_GAP;
  let currentX = startX;

  const maxNodesInAPillar = Math.max(...levels.map((level) => (groups.get(level) ?? []).length));
  const expectedMaxHeight = maxNodesInAPillar * ySpacing;
  const viewportCenterY = startY + expectedMaxHeight / 2;

  for (const level of levels) {
    const nodesAtLevel = groups.get(level) ?? [];
    const levelWidth = Math.max(
      TRANSCRIPT_NODE_MIN_WIDTH,
      ...nodesAtLevel.map((node) => (nodeSizes[node.id] ?? defaultNodeSize()).width),
    );

    const pillarHeight = Math.max(0, (nodesAtLevel.length - 1) * ySpacing);
    let currentY = viewportCenterY - pillarHeight / 2;

    nodesAtLevel.forEach((node) => {
      layout[node.id] = {
        x: currentX,
        y: currentY,
      };
      currentY += ySpacing;
    });

    currentX += levelWidth + TRANSCRIPT_NODE_X_GAP;
  }

  return layout;
}

function edgeGeometry(
  from: LayoutPosition,
  fromSize: NodeVisualSize,
  to: LayoutPosition,
  toSize: NodeVisualSize,
): { fromX: number; fromY: number; toX: number; toY: number; curve: string } {
  const fromX = from.x + fromSize.width;
  const fromY = from.y + fromSize.height / 2;
  const toX = to.x;
  const toY = to.y + toSize.height / 2;
  const dx = Math.abs(toX - fromX) * 0.5;
  return {
    fromX,
    fromY,
    toX,
    toY,
    curve: `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`,
  };
}

function renderModelOptions(selectedModel: string): string {
  const models = ['GPT-4o', 'Claude 3.5', 'GPT-4 Turbo', 'Llama 3'];
  return models
    .map((model) => `<option value="${model}" ${model === selectedModel ? 'selected' : ''}>${model}</option>`)
    .join('');
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function messageClass(tone: MessageTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-200';
    case 'error':
      return 'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-200';
    default:
      return 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200';
  }
}

function shortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function formatIsoDate(value: string | null): string {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function trimForPreview(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function esc(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

