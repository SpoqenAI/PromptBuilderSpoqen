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

type LayoutPosition = {
  x: number;
  y: number;
};

type LayoutMap = Record<string, LayoutPosition>;

const DEFAULT_PROJECT_NAME = 'Transcript Flow';
const DEFAULT_PROJECT_MODEL = 'GPT-4o';
const MIN_TRANSCRIPT_LENGTH = 20;
const DEFAULT_MAX_NODES = 18;

export function renderTranscriptImport(container: HTMLElement): void {
  let projectName = DEFAULT_PROJECT_NAME;
  let projectModel = DEFAULT_PROJECT_MODEL;
  let transcriptText = '';
  let transcriptFileName = '';
  let assistantName = 'Assistant';
  let userName = 'User';
  let maxNodes: number | undefined = DEFAULT_MAX_NODES;
  let autoNodeCount = false;

  let generatedFlow: TranscriptFlowResult | null = null;
  let generationError = '';
  let isGenerating = false;
  let selectedNodeId: string | null = null;

  // Persist viewport state across renders
  let savedZoom: number | null = null;
  let savedPanX: number | null = null;
  let savedPanY: number | null = null;

  function render(): void {
    const canGenerate = transcriptText.trim().length >= MIN_TRANSCRIPT_LENGTH && !isGenerating;
    const selectedNode = selectedNodeId && generatedFlow
      ? generatedFlow.nodes.find((n) => n.id === selectedNodeId) ?? null
      : null;

    preserveScrollDuringRender(container, () => {
      container.innerHTML = `
        <header class="h-14 border-b border-primary/10 flex items-center justify-between px-6 bg-white dark:bg-background-dark/80 z-20">
          <div class="flex items-center gap-3">
            <button type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer rounded" id="nav-home" aria-label="Go to dashboard">
              <img src="/Icon.svg" alt="Spoqen" class="w-8 h-8 object-contain" />
            </button>
            <div>
              <h1 class="text-sm font-semibold leading-none">Import Transcript (AI)</h1>
              <span class="text-[10px] text-slate-400 uppercase tracking-wider">Generate a hypothetical call-flow diagram</span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            ${generatedFlow ? `
              <button id="btn-regenerate-flow" type="button" class="px-3 py-1.5 text-xs font-medium border border-primary/30 text-primary hover:bg-primary/5 rounded transition-colors flex items-center gap-2">
                <span class="material-icons text-sm">refresh</span> Regenerate
              </button>
              <button id="btn-create-flow-project" type="button" class="px-4 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary/90 rounded transition-colors flex items-center gap-2">
                <span class="material-icons text-sm">add_circle</span> Create Project from Flow
              </button>
            ` : ''}
            ${themeToggleHTML()}
            <button id="btn-back" class="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 rounded transition-colors">
              Back
            </button>
          </div>
        </header>

        <main class="flex-1 min-h-0 flex overflow-hidden">
          <!-- Sidebar -->
          <aside class="w-72 border-r border-primary/10 bg-white dark:bg-background-dark/50 flex flex-col z-10 shrink-0">
            <div class="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar" data-scroll-preserve="transcript-import-sidebar">
              <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-100">Transcript Input</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">Upload or paste a transcript. AI converts it into a flow graph.</p>

              <div>
                <label for="transcript-project-name" class="block text-xs font-medium text-slate-500 mb-1">Project name</label>
                <input id="transcript-project-name" value="${esc(projectName)}" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label for="transcript-project-model" class="block text-xs font-medium text-slate-500 mb-1">Target model</label>
                <select id="transcript-project-model" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                  ${renderModelOptions(projectModel)}
                </select>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label for="transcript-assistant-name" class="block text-xs font-medium text-slate-500 mb-1">Assistant label</label>
                  <input id="transcript-assistant-name" value="${esc(assistantName)}" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Assistant" />
                </div>
                <div>
                  <label for="transcript-user-name" class="block text-xs font-medium text-slate-500 mb-1">User label</label>
                  <input id="transcript-user-name" value="${esc(userName)}" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" placeholder="User" />
                </div>
              </div>
              <div>
                <label class="block text-xs font-medium text-slate-500 mb-1">Maximum generated nodes</label>
                <div class="flex items-center gap-2">
                  <input id="transcript-max-nodes" type="number" min="6" max="40" value="${autoNodeCount ? '' : (maxNodes ?? DEFAULT_MAX_NODES)}" class="flex-1 rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary ${autoNodeCount ? 'opacity-40 pointer-events-none' : ''}" ${autoNodeCount ? 'disabled' : ''} />
                </div>
                <label class="flex items-center gap-2 mt-1.5 cursor-pointer">
                  <input id="transcript-auto-nodes" type="checkbox" class="rounded border-slate-300 text-primary focus:ring-primary" ${autoNodeCount ? 'checked' : ''} />
                  <span class="text-xs text-slate-500">Auto (let AI decide)</span>
                </label>
              </div>

              <div>
                <div class="flex items-center justify-between gap-2 mb-1">
                  <label for="transcript-text" class="text-xs font-medium text-slate-500">Transcript</label>
                  <span id="transcript-char-count" class="text-[11px] text-slate-400">${transcriptText.length} chars</span>
                </div>
                <textarea id="transcript-text" rows="10" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary custom-scrollbar" placeholder="Example:\nUser: I need to change my reservation.\nAssistant: Sure, I can help with that...">${esc(transcriptText)}</textarea>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <input id="transcript-file" type="file" accept=".txt,.md,.log,.json,.csv,.srt,.vtt" class="hidden" />
                  <button id="btn-upload-transcript" type="button" class="rounded-lg border border-card-border dark:border-primary/20 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    Upload file
                  </button>
                  ${transcriptFileName ? `<span class="text-[11px] text-slate-500 truncate max-w-[180px]" title="${esc(transcriptFileName)}">${esc(transcriptFileName)}</span>` : '<span class="text-[11px] text-slate-400">No file</span>'}
                </div>
              </div>

              ${generationError ? `<p id="transcript-generate-error" class="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-200">${esc(generationError)}</p>` : ''}

              <div class="flex flex-wrap gap-2 pt-1">
                <button id="btn-generate-flow" class="flex-1 rounded-lg bg-primary text-white px-4 py-2 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" ${canGenerate ? '' : 'disabled'}>
                  ${isGenerating ? 'Generating...' : 'Generate Flow'}
                </button>
                <button id="btn-clear-transcript" type="button" class="rounded-lg border border-card-border dark:border-primary/20 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  Clear
                </button>
              </div>

              <p class="text-[11px] text-slate-400">Requires <code>OPENAI_API_KEY</code> in Supabase Edge Functions.</p>
            </div>
            <div class="p-4 border-t border-primary/5 bg-slate-50 dark:bg-white/5">
              <div class="flex items-center gap-2">
                <div class="w-2 h-2 rounded-full ${generatedFlow ? 'bg-primary animate-pulse' : 'bg-slate-300'}"></div>
                <span class="text-[10px] font-medium text-slate-500 uppercase">${generatedFlow ? `${generatedFlow.nodes.length} Nodes · ${generatedFlow.connections.length} Connections` : 'No flow generated'}</span>
              </div>
            </div>
          </aside>

          <!-- Main Canvas Area -->
          <div class="flex-1 relative overflow-hidden bg-background-light dark:bg-background-dark canvas-grid">
            ${generatedFlow ? renderFlowCanvas(generatedFlow, selectedNode) : renderEmptyCanvas()}
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
      zoom = Math.max(MIN_ZOOM, Math.min(fitScale * 0.9, MAX_ZOOM));
      panX = (vw - ww * zoom) / 2;
      panY = (vh - wh * zoom) / 2;
    }

    function applyTransform(): void {
      world!.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      // Persist for next render
      savedZoom = zoom;
      savedPanX = panX;
      savedPanY = panY;
    }
    applyTransform();

    // Right-click drag panning (matches Canvas view exactly)
    let isPanning = false;
    let panStartMouseX = 0;
    let panStartMouseY = 0;
    let panStartX = 0;
    let panStartY = 0;

    viewport.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
    });

    viewport.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 2) return;
      isPanning = true;
      panStartMouseX = e.clientX;
      panStartMouseY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      viewport.classList.add('cursor-grabbing');
      e.preventDefault();
    });

    const onMouseMove = (e: MouseEvent): void => {
      if (!isPanning) return;
      panX = panStartX + (e.clientX - panStartMouseX);
      panY = panStartY + (e.clientY - panStartMouseY);
      applyTransform();
    };

    const onMouseUp = (): void => {
      if (!isPanning) return;
      isPanning = false;
      viewport.classList.remove('cursor-grabbing');
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    // Scroll-wheel zoom around cursor (matches Canvas view exactly)
    viewport.addEventListener('wheel', (e: WheelEvent) => {
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
    }, { passive: false });
  }

  function wireEvents(): void {
    container.querySelector<HTMLButtonElement>('#nav-home')?.addEventListener('click', () => {
      router.navigate('/');
    });

    container.querySelector<HTMLButtonElement>('#btn-back')?.addEventListener('click', () => {
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

    const autoNodesCheckbox = container.querySelector<HTMLInputElement>('#transcript-auto-nodes');
    const maxNodesInput = container.querySelector<HTMLInputElement>('#transcript-max-nodes');

    autoNodesCheckbox?.addEventListener('change', () => {
      autoNodeCount = autoNodesCheckbox.checked;
      if (autoNodeCount) {
        maxNodes = undefined;
      } else {
        maxNodes = DEFAULT_MAX_NODES;
      }
      render();
    });

    maxNodesInput?.addEventListener('change', () => {
      if (autoNodeCount) return;
      const parsed = Number.parseInt(maxNodesInput.value, 10);
      if (!Number.isFinite(parsed)) {
        maxNodes = DEFAULT_MAX_NODES;
      } else {
        maxNodes = Math.max(6, Math.min(40, parsed));
      }
      maxNodesInput.value = String(maxNodes);
    });

    const transcriptTextArea = container.querySelector<HTMLTextAreaElement>('#transcript-text');
    transcriptTextArea?.addEventListener('input', () => {
      transcriptText = transcriptTextArea.value;
      generationError = '';
      container.querySelector('#transcript-generate-error')?.remove();
      syncTranscriptControls();
    });

    const fileInput = container.querySelector<HTMLInputElement>('#transcript-file');
    container.querySelector<HTMLButtonElement>('#btn-upload-transcript')?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      void (async () => {
        try {
          const text = await file.text();
          transcriptText = normalizeLineEndings(text);
          transcriptFileName = file.name;
          generationError = '';
          render();
        } catch {
          generationError = 'Unable to read transcript file.';
          render();
        }
      })();
    });

    container.querySelector<HTMLButtonElement>('#btn-clear-transcript')?.addEventListener('click', () => {
      transcriptText = '';
      transcriptFileName = '';
      generationError = '';
      generatedFlow = null;
      selectedNodeId = null;
      render();
    });

    container.querySelector<HTMLButtonElement>('#btn-generate-flow')?.addEventListener('click', () => {
      void generateFlow();
    });

    container.querySelector<HTMLButtonElement>('#btn-create-flow-project')?.addEventListener('click', () => {
      createProjectFromGeneratedFlow();
    });

    container.querySelector<HTMLButtonElement>('#btn-regenerate-flow')?.addEventListener('click', () => {
      void generateFlow();
    });

    container.querySelector<HTMLButtonElement>('#btn-close-detail')?.addEventListener('click', () => {
      selectedNodeId = null;
      render();
    });

    // Wire clickable nodes
    container.querySelectorAll<HTMLElement>('[data-flow-node-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedNodeId = el.dataset.flowNodeId ?? null;
        render();
      });
    });

    // Click canvas background to deselect
    container.querySelector<HTMLElement>('#flow-viewport')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'flow-viewport' || (e.target as HTMLElement).closest('svg')) {
        if (selectedNodeId) {
          selectedNodeId = null;
          render();
        }
      }
    });
  }

  async function generateFlow(): Promise<void> {
    if (isGenerating) return;

    const transcript = normalizeLineEndings(transcriptText).trim();
    if (transcript.length < MIN_TRANSCRIPT_LENGTH) {
      generationError = `Transcript must be at least ${MIN_TRANSCRIPT_LENGTH} characters.`;
      render();
      return;
    }

    isGenerating = true;
    generationError = '';
    render();

    try {
      const flow = await generateTranscriptFlow({
        transcript,
        maxNodes: autoNodeCount ? undefined : maxNodes,
        assistantName: assistantName.trim() || undefined,
        userName: userName.trim() || undefined,
      });

      generatedFlow = flow;
      transcriptText = transcript;
      if (projectName.trim().length === 0 || projectName === DEFAULT_PROJECT_NAME) {
        projectName = flow.title;
      }
    } catch (err) {
      generationError = err instanceof Error ? err.message : 'Failed to generate flow from transcript.';
    } finally {
      isGenerating = false;
      render();
    }
  }

  function syncTranscriptControls(): void {
    const charCount = container.querySelector<HTMLElement>('#transcript-char-count');
    if (charCount) {
      charCount.textContent = `${transcriptText.length} chars`;
    }

    const generateButton = container.querySelector<HTMLButtonElement>('#btn-generate-flow');
    if (generateButton) {
      generateButton.disabled = transcriptText.trim().length < MIN_TRANSCRIPT_LENGTH || isGenerating;
    }
  }

  function createProjectFromGeneratedFlow(): void {
    if (!generatedFlow) return;

    const normalizedProjectName = projectName.trim() || generatedFlow.title || DEFAULT_PROJECT_NAME;
    const project = store.createProject(
      normalizedProjectName,
      generatedFlow.summary,
      projectModel,
    );

    const layout = computeFlowLayout(generatedFlow);
    const nodeIdMap = new Map<string, string>();

    for (const generatedNode of generatedFlow.nodes) {
      const position = layout[generatedNode.id] ?? { x: 80, y: 80 };
      const promptNode: PromptNode = {
        id: uid(),
        type: generatedNode.type,
        label: generatedNode.label,
        icon: normalizeIconName(generatedNode.icon),
        x: position.x,
        y: position.y,
        content: generatedNode.content,
        meta: { ...generatedNode.meta },
      };

      store.addNode(project.id, promptNode);
      nodeIdMap.set(generatedNode.id, promptNode.id);
    }

    for (const connection of generatedFlow.connections) {
      const from = nodeIdMap.get(connection.from);
      const to = nodeIdMap.get(connection.to);
      if (!from || !to || from === to) continue;
      store.addConnection(project.id, from, to);
    }

    store.saveAssembledVersion(project.id, 'Initial transcript flow import');
    router.navigate(`/project/${project.id}`);
  }

  render();
}

function renderEmptyCanvas(): string {
  return `
    <div class="flex flex-col items-center justify-center h-full">
      <div class="relative group">
        <div class="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity"></div>
        <div class="relative w-48 bg-white dark:bg-slate-900 border-2 border-primary rounded-xl p-4 shadow-xl flex flex-col items-center gap-3">
          <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <span class="material-icons text-primary">account_tree</span>
          </div>
          <div class="text-center">
            <h2 class="text-sm font-bold">Flow Preview</h2>
            <p class="text-[10px] text-slate-400">Generate a flow to see the graph here</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFlowCanvas(flow: TranscriptFlowResult, selectedNode: TranscriptFlowNode | null): string {
  const layout = computeFlowLayout(flow);
  const geometry = computeCanvasGeometry(layout);
  const NODE_WIDTH = 220;

  const edges = flow.connections
    .map((connection) => {
      const from = layout[connection.from];
      const to = layout[connection.to];
      if (!from || !to) return '';

      const fromX = from.x + NODE_WIDTH;
      const fromY = from.y + 48;
      const toX = to.x;
      const toY = to.y + 48;
      const dx = Math.abs(toX - fromX) * 0.5;
      const curve = `M ${fromX} ${fromY} C ${fromX + dx} ${fromY}, ${toX - dx} ${toY}, ${toX} ${toY}`;

      return `
        <path d="${curve}" stroke="#23956F" stroke-width="2" fill="none" class="connector-path" />
        <circle cx="${fromX}" cy="${fromY}" r="5" fill="#23956F" />
        <circle cx="${toX}" cy="${toY}" r="5" fill="#23956F" />
        <circle r="3" fill="#23956F" opacity="0.7"><animateMotion dur="3s" repeatCount="indefinite" path="${curve}" /></circle>
      `;
    })
    .join('');

  const nodes = flow.nodes
    .map((node) => {
      const position = layout[node.id] ?? { x: 80, y: 80 };
      const isSelected = node.id === selectedNode?.id;
      const contentPreview = esc(node.content).substring(0, 120) + (node.content.length > 120 ? '…' : '');

      return `
        <div class="canvas-node pointer-events-auto bg-white dark:bg-slate-900 border ${isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-primary/40'} rounded-lg shadow-xl node-glow cursor-pointer"
             data-flow-node-id="${esc(node.id)}"
             style="left:${position.x}px; top:${position.y}px; width:${NODE_WIDTH}px;">
          <div class="node-header bg-primary/10 border-b border-primary/20 p-3 flex items-center justify-between rounded-t-lg overflow-hidden">
            <h2 class="text-xs font-bold flex items-center gap-2 select-none min-w-0 overflow-hidden">
              <span class="material-icons text-sm text-primary shrink-0">${node.icon}</span>
              <span class="truncate">${esc(node.label)}</span>
            </h2>
          </div>
          <div class="relative">
            <div class="p-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono leading-relaxed max-h-24 overflow-hidden">
              ${contentPreview}
            </div>
          </div>
          <div class="bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 flex justify-end items-center rounded-b-lg border-t border-primary/10">
            <span class="text-[9px] text-primary/60 font-mono">${node.content.length > 0 ? Math.ceil(node.content.length / 4) + ' tok' : 'empty'}</span>
          </div>
        </div>
      `;
    })
    .join('');

  const detailPanel = selectedNode ? `
    <div class="absolute top-4 right-4 w-80 bg-white dark:bg-slate-900 border border-primary/20 rounded-xl shadow-2xl z-20 max-h-[calc(100%-2rem)] flex flex-col">
      <div class="flex items-center justify-between p-3 border-b border-primary/10">
        <div class="flex items-center gap-2 min-w-0">
          <span class="material-icons text-sm text-primary shrink-0">${selectedNode.icon}</span>
          <span class="text-xs font-bold truncate">${esc(selectedNode.label)}</span>
        </div>
        <button id="btn-close-detail" class="text-slate-400 hover:text-slate-600 p-0.5 shrink-0 cursor-pointer" title="Close">
          <span class="material-icons text-sm">close</span>
        </button>
      </div>
      <div class="p-3 overflow-y-auto custom-scrollbar space-y-2">
        <div class="text-xs text-slate-700 dark:text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">${esc(selectedNode.content)}</div>
        ${Object.keys(selectedNode.meta).length > 0 ? `
          <div class="border-t border-primary/10 pt-2 mt-2">
            <span class="text-[9px] text-slate-400 uppercase tracking-wider">Metadata</span>
            ${Object.entries(selectedNode.meta).map(([k, v]) => `<div class="text-[11px] text-slate-500 mt-1"><span class="font-medium">${esc(k)}:</span> ${esc(v)}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  const infoBar = `
    <div class="absolute top-4 left-6 flex items-center gap-2 text-xs font-medium text-slate-400 bg-white/80 dark:bg-background-dark/80 px-3 py-1.5 rounded-full border border-primary/10 shadow-sm z-10">
      <span class="text-slate-800 dark:text-slate-200">${esc(flow.title)}</span>
      <span class="text-[10px]">·</span>
      <span>${flow.nodes.length} nodes</span>
      <span class="text-[10px]">·</span>
      <span>${flow.connections.length} connections</span>
    </div>
  `;

  const fallbackBanner = flow.usedFallback
    ? `<div class="absolute bottom-4 left-6 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-200 z-10">${esc(flow.warning ?? 'AI unavailable, using deterministic fallback.')}</div>`
    : '';

  return `
    ${infoBar}
    ${fallbackBanner}
    ${detailPanel}
    <div id="flow-viewport" class="absolute inset-0 overflow-hidden">
      <div id="flow-world" style="transform-origin:0 0; position:absolute; width:${geometry.width}px; height:${geometry.height}px;">
        <svg class="absolute inset-0 pointer-events-none z-[1]" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          ${edges}
        </svg>
        <div class="absolute inset-0 z-[2] pointer-events-none">
          ${nodes}
        </div>
      </div>
    </div>
  `;
}

function computeCanvasGeometry(layout: LayoutMap): { width: number; height: number } {
  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 96;

  let maxX = 0;
  let maxY = 0;

  for (const position of Object.values(layout)) {
    maxX = Math.max(maxX, position.x + NODE_WIDTH);
    maxY = Math.max(maxY, position.y + NODE_HEIGHT);
  }

  return {
    width: Math.max(maxX + 80, 760),
    height: Math.max(maxY + 80, 420),
  };
}

function computeFlowLayout(flow: TranscriptFlowResult): LayoutMap {
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
  const xSpacing = 320;
  const ySpacing = 170;

  for (const level of levels) {
    const nodesAtLevel = groups.get(level) ?? [];
    nodesAtLevel.forEach((node, index) => {
      layout[node.id] = {
        x: startX + level * xSpacing,
        y: startY + index * ySpacing,
      };
    });
  }

  return layout;
}

function renderModelOptions(selectedModel: string): string {
  const models = ['GPT-4o', 'Claude 3.5', 'GPT-4 Turbo', 'Llama 3'];
  return models
    .map((model) => `<option value="${model}" ${model === selectedModel ? 'selected' : ''}>${model}</option>`)
    .join('');
}

function normalizeIconName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return normalized || 'widgets';
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
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
