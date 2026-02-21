/**
 * Canvas View — Node graph editor with drag/drop (matches page2.html mockup)
 */
import { store } from '../store';
import { router } from '../router';
import { BLOCK_PALETTE, PromptNode, uid, CustomNodeTemplate } from '../models';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { clearProjectEscapeToCanvas, projectViewTabsHTML, wireProjectViewTabs } from './project-nav';
import { customPrompt, customConfirm } from '../dialogs';
import { buildNodeColorStyles, readNodeColorMeta } from '../node-colors';

interface CanvasViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

interface CanvasViewContainer extends HTMLElement {
  __pbCanvasCleanup?: () => void;
}

interface NodeVisualSize {
  width: number;
  height: number;
}

interface SidebarBlock {
  type: PromptNode['type'];
  label: string;
  icon: string;
  category: string;
  defaultContent: string;
  meta: Record<string, string>;
  templateId?: string;
  isCustomTemplate: boolean;
}

interface McpRelayConfig {
  enabled: boolean;
  canvasSyncUrl: string | null;
  agentRelayUrl: string | null;
  reason: string | null;
}

const canvasViewportByProject = new Map<string, CanvasViewportState>();
const canvasSidebarCollapsedByProject = new Map<string, boolean>();
const canvasSidebarWidthByProject = new Map<string, number>();
const MIN_CANVAS_SIDEBAR_WIDTH = 200;
const MAX_CANVAS_SIDEBAR_WIDTH = 560;
const sidebarLabelMeasureCanvas = document.createElement('canvas');
const sidebarLabelMeasureCtx = sidebarLabelMeasureCanvas.getContext('2d');

function clearCanvasViewCleanup(container: HTMLElement): void {
  const host = container as CanvasViewContainer;
  if (!host.__pbCanvasCleanup) return;
  host.__pbCanvasCleanup();
  delete host.__pbCanvasCleanup;
}

function readCanvasViewportState(projectId: string): CanvasViewportState | null {
  const state = canvasViewportByProject.get(projectId);
  if (!state) return null;
  return { ...state };
}

function writeCanvasViewportState(projectId: string, state: CanvasViewportState): void {
  canvasViewportByProject.set(projectId, { ...state });
}

function readCanvasSidebarCollapsedState(projectId: string): boolean {
  return canvasSidebarCollapsedByProject.get(projectId) ?? false;
}

function writeCanvasSidebarCollapsedState(projectId: string, collapsed: boolean): void {
  canvasSidebarCollapsedByProject.set(projectId, collapsed);
}

function readCanvasSidebarWidthState(projectId: string): number | null {
  const width = canvasSidebarWidthByProject.get(projectId);
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null;
  return width;
}

function writeCanvasSidebarWidthState(projectId: string, width: number): void {
  if (!Number.isFinite(width) || width <= 0) return;
  canvasSidebarWidthByProject.set(projectId, width);
}

function estimateSidebarLabelPixelWidth(label: string): number {
  const text = label.trim().length > 0 ? label : 'Node';
  if (!sidebarLabelMeasureCtx) return text.length * 7;
  sidebarLabelMeasureCtx.font = '500 12px Inter, system-ui, -apple-system, sans-serif';
  return Math.ceil(sidebarLabelMeasureCtx.measureText(text).width);
}

function computeRecommendedSidebarWidth(categories: Map<string, SidebarBlock[]>): number {
  let longestLabelWidth = 0;
  for (const blocks of categories.values()) {
    for (const block of blocks) {
      longestLabelWidth = Math.max(longestLabelWidth, estimateSidebarLabelPixelWidth(block.label));
    }
  }
  const sidebarChromeWidth = 108;
  const calculated = longestLabelWidth + sidebarChromeWidth;
  return Math.max(MIN_CANVAS_SIDEBAR_WIDTH, Math.min(MAX_CANVAS_SIDEBAR_WIDTH, calculated));
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeRelayBaseUrl(rawValue: string): URL | null {
  try {
    const url = new URL(rawValue, window.location.origin);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function buildRelaySocketUrl(segment: 'canvas-sync' | 'agent-relay', baseUrl: URL | null): string {
  if (!baseUrl) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/${segment}`;
  }

  const relayUrl = new URL(baseUrl.toString());
  relayUrl.protocol = relayUrl.protocol === 'https:' || relayUrl.protocol === 'wss:' ? 'wss:' : 'ws:';

  const normalizedPath = relayUrl.pathname.replace(/\/+$/, '');
  const hasSegmentPath = normalizedPath === `/${segment}` || normalizedPath.endsWith(`/${segment}`);
  if (hasSegmentPath) {
    relayUrl.pathname = normalizedPath || `/${segment}`;
  } else {
    const pathPrefix = normalizedPath && normalizedPath !== '/' ? normalizedPath : '';
    relayUrl.pathname = `${pathPrefix}/${segment}`.replace(/\/{2,}/g, '/');
  }

  relayUrl.search = '';
  relayUrl.hash = '';
  return relayUrl.toString();
}

function resolveMcpRelayConfig(): McpRelayConfig {
  const enabledByEnv = parseBooleanEnv(import.meta.env.NEXT_PUBLIC_ENABLE_MCP_RELAY, import.meta.env.DEV);
  if (!enabledByEnv) {
    return {
      enabled: false,
      canvasSyncUrl: null,
      agentRelayUrl: null,
      reason: 'MCP relay is disabled. Set NEXT_PUBLIC_ENABLE_MCP_RELAY=true to enable agent sync.',
    };
  }

  const rawRelayUrl = import.meta.env.NEXT_PUBLIC_MCP_RELAY_URL?.trim();
  const relayBaseUrl = rawRelayUrl ? normalizeRelayBaseUrl(rawRelayUrl) : null;
  if (rawRelayUrl && !relayBaseUrl) {
    return {
      enabled: false,
      canvasSyncUrl: null,
      agentRelayUrl: null,
      reason: 'Invalid NEXT_PUBLIC_MCP_RELAY_URL. Use an http(s) or ws(s) URL.',
    };
  }

  return {
    enabled: true,
    canvasSyncUrl: buildRelaySocketUrl('canvas-sync', relayBaseUrl),
    agentRelayUrl: buildRelaySocketUrl('agent-relay', relayBaseUrl),
    reason: null,
  };
}

function buildSidebarCategories(customTemplates: CustomNodeTemplate[]): Map<string, SidebarBlock[]> {
  const categories = new Map<string, SidebarBlock[]>();
  for (const block of BLOCK_PALETTE) {
    if (!categories.has(block.category)) categories.set(block.category, []);
    categories.get(block.category)!.push({
      type: block.type,
      label: block.label,
      icon: block.icon,
      category: block.category,
      defaultContent: block.defaultContent,
      meta: {},
      isCustomTemplate: false,
    });
  }

  const customCategory = 'My Custom Nodes';
  categories.set(customCategory, customTemplates.map((template) => ({
    type: template.type,
    label: template.label,
    icon: template.icon,
    category: customCategory,
    defaultContent: template.content,
    meta: { ...template.meta },
    templateId: template.id,
    isCustomTemplate: true,
  })));

  return categories;
}

function renderSidebarBlocksHTML(categories: Map<string, SidebarBlock[]>): string {
  return [...categories.entries()].map(([category, blocks]) => {
    const isCustomCategory = category === 'My Custom Nodes';
    const customEmptyState = isCustomCategory && blocks.length === 0
      ? `<p class="px-2 py-2 text-[11px] text-slate-400">Save any canvas node as a template to reuse it here.</p>`
      : '';

    return `
      <section data-category="${escapeHTML(category)}">
        <h3 class="px-2 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">${escapeHTML(category)}</h3>
        <div class="space-y-1">
          ${blocks.map((block) => {
      const encodedMeta = encodeURIComponent(JSON.stringify(block.meta));
      return `
              <div
                class="sidebar-block group flex items-center gap-3 p-2 rounded cursor-grab hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-primary/20"
                draggable="true"
                data-type="${block.type}"
                data-label="${escapeHTML(block.label)}"
                data-icon="${escapeHTML(block.icon)}"
                data-default="${encodeURIComponent(block.defaultContent)}"
                data-meta="${encodedMeta}"
                data-template-id="${block.templateId ?? ''}"
                data-is-custom="${block.isCustomTemplate ? '1' : '0'}"
              >
                <span class="material-icons text-sm text-primary">${escapeHTML(block.icon)}</span>
                <span class="text-xs font-medium truncate">${escapeHTML(block.label)}</span>
                ${block.isCustomTemplate
          ? `<button type="button" class="sidebar-custom-delete ml-auto p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" data-template-id="${block.templateId ?? ''}" title="Delete custom node template">
                      <span class="material-icons text-sm">delete_outline</span>
                    </button>`
          : ''}
              </div>
            `;
    }).join('')}
          ${customEmptyState}
        </div>
      </section>
    `;
  }).join('');
}

export function renderCanvas(container: HTMLElement, projectId: string): void {
  clearCanvasViewCleanup(container);
  const project = store.getProject(projectId);
  if (!project) { router.navigate('/'); return; }
  clearProjectEscapeToCanvas(container);

  const categories = buildSidebarCategories(store.getCustomNodeTemplates());
  const recommendedSidebarWidth = computeRecommendedSidebarWidth(categories);
  const mcpRelayConfig = resolveMcpRelayConfig();
  const relaySetupInstructionHtml = mcpRelayConfig.enabled && mcpRelayConfig.agentRelayUrl
    ? `
      <div class="bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg p-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all select-all flex flex-col gap-3">
        <span class="text-slate-500">// 1. Run this connector from your app directory:</span>
        <span class="text-primary font-medium user-select-all" id="mcp-connect-string">node mcp-connector/index.js --url ${escapeHTML(mcpRelayConfig.agentRelayUrl)}</span>
      </div>
    `
    : `
      <div class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg p-3 text-[11px] text-amber-800 dark:text-amber-100 leading-relaxed">
        ${escapeHTML(mcpRelayConfig.reason ?? 'MCP relay is unavailable in this deployment.')}
      </div>
    `;

  container.innerHTML = `
    <!-- Top Navigation Bar -->
    <header class="ui-header z-20">
      <div class="ui-header-left">
        <div class="flex items-center gap-3 min-w-0">
          <button type="button" class="h-10 w-10 flex items-center justify-center cursor-pointer rounded shrink-0" id="nav-home" aria-label="Go to dashboard">
            <img src="/Icon.svg" alt="Spoqen" class="h-10 w-10 object-contain" />
          </button>
          <div class="min-w-0">
            <h1 class="text-sm font-semibold leading-none truncate max-w-[34ch]" title="${escapeHTML(project.name)}">${project.name}</h1>
            <span class="text-[10px] text-slate-400 uppercase tracking-wider">Visual Prompt Editor</span>
          </div>
        </div>
        <div class="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block"></div>
        <div class="flex items-center gap-1 text-xs text-slate-500">
          <span class="material-icons text-sm">cloud_done</span>
          <span>Saved</span>
        </div>
      </div>
      <div class="ui-header-center">
        ${projectViewTabsHTML('canvas')}
      </div>
      <div class="ui-header-right ui-toolbar">
        ${themeToggleHTML()}
        <button id="btn-save-snapshot" class="ui-btn ui-btn-outline">
          <span class="material-icons text-sm">save</span> Save Current State
        </button>
        <button id="btn-copy-runtime" class="ui-btn ui-btn-primary">
          <span class="material-icons text-sm">content_copy</span> Copy Runtime
        </button>
        <button id="btn-copy-flow" class="ui-btn ui-btn-outline">
          <span class="material-icons text-sm">account_tree</span> Copy Flow Template
        </button>
      </div>
    </header>

    <main id="canvas-main" class="ui-main ui-stack-lg">
      <!-- Sidebar -->
      <aside id="canvas-sidebar" class="ui-sidebar canvas-sidebar border-r border-primary/10 bg-white dark:bg-background-dark/50 z-10">
        <div class="p-4 border-b border-primary/5">
          <div class="flex items-center justify-between gap-2 mb-3">
            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Menu</span>
            <button id="btn-collapse-canvas-sidebar" class="h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors" aria-expanded="true" aria-controls="canvas-sidebar" aria-label="Collapse menu" title="Collapse menu">
              <span class="material-icons text-sm">chevron_left</span>
            </button>
          </div>
          <div class="relative">
            <span class="material-icons absolute left-2.5 top-2.5 text-slate-400 text-sm">search</span>
            <input id="sidebar-search" class="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all" placeholder="Search blocks..." type="text" />
          </div>
        </div>
        <div class="ui-scroll p-2 space-y-4 custom-scrollbar" id="sidebar-blocks">
          ${renderSidebarBlocksHTML(categories)}
        </div>
        <div class="p-4 border-t border-primary/5 bg-slate-50 dark:bg-white/5">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
            <span class="text-[10px] font-medium text-slate-500 uppercase">${project.nodes.length} Nodes</span>
          </div>
        </div>
        <div id="canvas-sidebar-resize-handle" class="canvas-sidebar-resize-handle" role="separator" aria-label="Resize menu" aria-orientation="vertical"></div>
      </aside>

      <!-- Main Canvas Area -->
      <div id="canvas-area" class="ui-pane flex-1 relative overflow-hidden bg-background-light dark:bg-background-dark canvas-grid">
        <!-- Top Left Controls -->
        <div class="absolute top-4 left-4 max-w-[min(92vw,50rem)] flex items-center gap-2 z-10">
          <button id="btn-open-canvas-sidebar" class="hidden h-8 px-3 inline-flex items-center gap-1 rounded-full border border-primary/20 bg-white/85 dark:bg-background-dark/85 text-xs font-semibold text-primary shadow-sm backdrop-blur-sm hover:bg-white dark:hover:bg-background-dark transition-colors" aria-expanded="false" aria-controls="canvas-sidebar" aria-label="Expand menu" title="Expand menu">
            <span class="material-icons text-sm">menu</span>
            Menu
          </button>
          <div class="max-w-[min(80vw,40rem)] flex items-center gap-2 text-xs font-medium text-slate-400 bg-white/80 dark:bg-background-dark/80 px-3 py-1.5 rounded-full border border-primary/10 shadow-sm">
            <span class="cursor-pointer hover:text-primary" id="crumb-home">Projects</span>
            <span class="material-icons text-[10px]">chevron_right</span>
            <span class="text-slate-800 dark:text-slate-200 truncate" title="${escapeHTML(project.name)}">${project.name}</span>
          </div>
        </div>

        <!-- SVG for connections -->
        <svg id="connection-svg" class="absolute inset-0 w-full h-full pointer-events-auto z-[1]"></svg>

        <!-- Nodes container -->
        <div id="nodes-container" class="absolute inset-0 z-[2] pointer-events-none">
          ${project.nodes.length === 0 ? `
            <!-- Empty Canvas Centered Content -->
            <div class="flex flex-col items-center justify-center h-full" id="empty-hint">
              <div class="relative group">
                <div class="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity"></div>
                <div class="relative w-48 bg-white dark:bg-slate-900 border-2 border-primary rounded-xl p-4 shadow-xl flex flex-col items-center gap-3">
                  <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <span class="material-icons text-primary">play_circle_filled</span>
                  </div>
                  <div class="text-center">
                    <h2 class="text-sm font-bold">Start Node</h2>
                    <p class="text-[10px] text-slate-400">Drag blocks from sidebar</p>
                  </div>
                </div>
              </div>
              <p class="mt-8 text-sm text-slate-400 animate-bounce">
                Drag blocks from the sidebar or click <span class="text-primary font-bold">+</span> to begin
              </p>
            </div>
          ` : ''}
        </div>

        <!-- Canvas Help Panel -->
        <div id="canvas-help-panel" class="hidden absolute bottom-20 right-4 w-[min(22rem,calc(100vw-2rem))] max-h-[min(60vh,26rem)] overflow-y-auto custom-scrollbar bg-white/95 dark:bg-slate-900/95 border border-primary/20 rounded-xl shadow-2xl backdrop-blur-sm z-20">
          <div class="flex items-start justify-between gap-3 px-4 py-3 border-b border-primary/10">
            <div>
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">Canvas Controls</h3>
              <p class="text-[10px] text-slate-400 mt-0.5">Quick guide for editing the graph</p>
            </div>
            <button id="btn-canvas-help-close" class="w-6 h-6 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors" aria-label="Close help panel">
              <span class="material-icons text-sm">close</span>
            </button>
          </div>
          <div class="px-4 py-3 space-y-2 text-[11px] text-slate-600 dark:text-slate-300">
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Right-click + drag:</span> Pan around the canvas.</div>
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Scroll:</span> Zoom in and out.</div>
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Drag between ports (either direction):</span> Connect nodes.</div>
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Click one port, then another:</span> Connect without dragging.</div>
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Click a connection, then press Delete:</span> Remove it.</div>
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Double-click a connection (or press L when selected):</span> Set branch label.</div>
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Drop a new block on a connection:</span> Insert it between nodes.</div>
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Shift + drag a node, then drop on a connection:</span> Reinsert it elsewhere.</div>
          </div>
        </div>

        <!-- Floating Controls -->
        <div class="absolute bottom-4 right-4 flex items-center gap-2 z-10">
          <div class="flex flex-col gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-lg border border-primary/10 shadow-lg">
            <button class="w-8 h-8 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center justify-center text-slate-500 hover:text-primary transition-colors" id="btn-zoom-in">
              <span class="material-icons text-lg">add</span>
            </button>
            <div class="h-px bg-slate-100 dark:bg-white/10 mx-1"></div>
            <button class="w-8 h-8 hover:bg-slate-100 dark:hover:bg-white/5 rounded flex items-center justify-center text-slate-500 hover:text-primary transition-colors" id="btn-zoom-out">
              <span class="material-icons text-lg">remove</span>
            </button>
          </div>
        </div>

        <!-- Mini Map -->
        <div id="minimap" class="hidden md:block absolute bottom-4 left-4 w-32 h-24 bg-white/65 dark:bg-slate-900/65 border border-primary/15 rounded-lg overflow-hidden backdrop-blur-sm z-10">
          <svg id="minimap-svg" class="w-full h-full block">
            <rect id="minimap-bg" x="0" y="0" width="100%" height="100%" fill="transparent"></rect>
            <g id="minimap-nodes"></g>
            <rect id="minimap-viewport" x="0" y="0" width="0" height="0" rx="1.5" fill="rgba(14, 165, 233, 0.16)" stroke="#0ea5e9" stroke-width="1"></rect>
          </svg>
          <div class="pointer-events-none absolute bottom-1 right-1 text-[8px] text-slate-400 uppercase font-bold">MiniMap</div>
        </div>

        <!-- Backend MCP Connector Info Panel -->
        <div id="terminal-panel" class="hidden absolute bottom-6 right-16 w-[420px] bg-white/95 dark:bg-slate-900/95 border border-primary/20 rounded-xl shadow-2xl backdrop-blur-sm z-30 flex flex-col transition-opacity opacity-0 data-[open=true]:opacity-100 data-[open=true]:flex">
          <div class="flex items-center justify-between px-4 py-3 border-b border-primary/10">
            <div class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              <span class="material-icons text-[14px] text-primary">hub</span>
              External Agent Connection
            </div>
            <button id="btn-terminal-close" class="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors" title="Close">
              <span class="material-icons text-[16px]">close</span>
            </button>
          </div>
          <div class="p-4 flex flex-col gap-4 text-xs">
            <p class="text-slate-600 dark:text-slate-300 leading-relaxed">
              Connect external AI CLI tools (like Claude Code or Gemini CLI) directly to this canvas. The tool will be able to read your nodes and execute diagram edits.
            </p>
            <div class="flex flex-col gap-2">
              <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Setup Instructions</label>
              ${relaySetupInstructionHtml}
            </div>
          </div>
        </div>
      </div>

      <!-- Right Properties Panel (Collapsed) -->
      <aside class="hidden lg:flex w-12 border-l border-primary/10 bg-white dark:bg-background-dark/50 flex-col items-center py-4 gap-4 shrink-0">
        <button class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/5 rounded transition-all" title="Properties">
          <span class="material-icons text-lg">tune</span>
        </button>
        <button id="btn-toggle-terminal" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/5 rounded transition-all" title="Agent Terminal">
          <span class="material-icons text-lg">terminal</span>
        </button>
        <button class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/5 rounded transition-all" title="Logs">
          <span class="material-icons text-lg">list_alt</span>
        </button>
        <div class="mt-auto">
          <button id="btn-canvas-help" class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/5 rounded transition-all" title="Canvas help" aria-expanded="false" aria-controls="canvas-help-panel">
            <span class="material-icons text-lg">help_outline</span>
          </button>
        </div>
      </aside>
    </main>
  `;

  // -- Render existing nodes -----------
  const canvasArea = container.querySelector<HTMLElement>('#canvas-area')!;
  const nodesContainer = container.querySelector<HTMLElement>('#nodes-container')!;
  const svgEl = container.querySelector<SVGSVGElement>('#connection-svg')!;
  const miniMapEl = container.querySelector<HTMLElement>('#minimap');
  const miniMapSvg = container.querySelector<SVGSVGElement>('#minimap-svg');
  const miniMapNodesLayer = container.querySelector<SVGGElement>('#minimap-nodes');
  const miniMapViewport = container.querySelector<SVGRectElement>('#minimap-viewport');
  const teardownCallbacks: Array<() => void> = [];
  const activeNodeDragDisposers = new Set<() => void>();

  const registerTeardown = (callback: () => void): void => {
    teardownCallbacks.push(callback);
  };

  function addManagedListener<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  function addManagedListener<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  function addManagedListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void;
  function addManagedListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, listener, options);
    registerTeardown(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  const teardownCanvas = (): void => {
    for (const disposeNodeDrag of Array.from(activeNodeDragDisposers)) {
      disposeNodeDrag();
    }
    activeNodeDragDisposers.clear();
    while (teardownCallbacks.length > 0) {
      const dispose = teardownCallbacks.pop();
      dispose?.();
    }
  };

  (container as CanvasViewContainer).__pbCanvasCleanup = teardownCanvas;
  const onHashChange = (): void => {
    clearCanvasViewCleanup(container);
  };
  addManagedListener(window, 'hashchange', onHashChange, { once: true });

  // Viewport (world -> screen): screen = world * zoom + pan
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2.5;
  const ZOOM_STEP = 0.12;
  const NODE_MIN_WIDTH = 224;
  const NODE_VISUAL_HEIGHT = 140;
  const NODE_DECORATION_WIDTH = 128;
  const MINIMAP_PADDING = 80;
  const MAX_CONNECTION_LABEL_LENGTH = 80;
  const nodeLabelMeasureCanvas = document.createElement('canvas');
  const nodeLabelMeasureCtx = nodeLabelMeasureCanvas.getContext('2d');
  const nodeVisualSizeById = new Map<string, NodeVisualSize>();
  const initialSidebarCollapsed = readCanvasSidebarCollapsedState(projectId);
  const storedInitialSidebarWidth = readCanvasSidebarWidthState(projectId) ?? recommendedSidebarWidth;
  const initialSidebarWidth = Math.max(MIN_CANVAS_SIDEBAR_WIDTH, Math.min(MAX_CANVAS_SIDEBAR_WIDTH, storedInitialSidebarWidth));
  let zoom = 1;
  let panX = project.nodes.length > 0 && !initialSidebarCollapsed ? initialSidebarWidth + 24 : 0;
  let panY = 0;
  const savedViewport = readCanvasViewportState(projectId);
  if (savedViewport) {
    zoom = clamp(savedViewport.zoom, MIN_ZOOM, MAX_ZOOM);
    panX = savedViewport.panX;
    panY = savedViewport.panY;
  }

  interface MiniMapTransform {
    minX: number;
    minY: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  }
  let miniMapTransform: MiniMapTransform | null = null;

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeConnectionLabel(value: string): string {
    return value.trim().replace(/\s+/g, ' ').slice(0, MAX_CONNECTION_LABEL_LENGTH);
  }

  function normalizeWheelDelta(event: WheelEvent): number {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
    return event.deltaY;
  }

  function estimateLabelPixelWidth(label: string): number {
    const text = label.trim().length > 0 ? label : 'Node';
    if (!nodeLabelMeasureCtx) return text.length * 7;
    nodeLabelMeasureCtx.font = '700 12px system-ui, -apple-system, sans-serif';
    return Math.ceil(nodeLabelMeasureCtx.measureText(text).width);
  }

  function getNodeVisualSize(node: PromptNode): NodeVisualSize {
    const cached = nodeVisualSizeById.get(node.id);
    const labelWidth = estimateLabelPixelWidth(node.label);
    const nextSize: NodeVisualSize = {
      width: Math.max(NODE_MIN_WIDTH, labelWidth + NODE_DECORATION_WIDTH),
      height: NODE_VISUAL_HEIGHT,
    };
    if (cached && cached.width === nextSize.width && cached.height === nextSize.height) {
      return cached;
    }
    nodeVisualSizeById.set(node.id, nextSize);
    return nextSize;
  }

  let drawScheduledFrame: number | null = null;
  function scheduleDrawConnections(): void {
    if (drawScheduledFrame !== null) return;
    drawScheduledFrame = window.requestAnimationFrame(() => {
      drawScheduledFrame = null;
      drawConnections();
    });
  }

  registerTeardown(() => {
    if (drawScheduledFrame === null) return;
    window.cancelAnimationFrame(drawScheduledFrame);
    drawScheduledFrame = null;
  });

  function applyViewportTransform(): void {
    nodesContainer.style.transformOrigin = '0 0';
    nodesContainer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    writeCanvasViewportState(projectId, { zoom, panX, panY });
  }

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvasArea.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    return {
      x: (localX - panX) / zoom,
      y: (localY - panY) / zoom,
    };
  }

  function zoomAt(nextZoom: number, focalX: number, focalY: number): void {
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (clamped === zoom) return;
    const worldXAtFocal = (focalX - panX) / zoom;
    const worldYAtFocal = (focalY - panY) / zoom;
    panX = focalX - worldXAtFocal * clamped;
    panY = focalY - worldYAtFocal * clamped;
    zoom = clamped;
    applyViewportTransform();
    scheduleDrawConnections();
  }

  // Track port-to-port connection drawing state
  type PortType = 'in' | 'out';
  interface ConnectionDraft {
    nodeId: string;
    portType: PortType;
    armedByClick: boolean;
  }
  let connectionDraft: ConnectionDraft | null = null;
  let tempLine: SVGLineElement | null = null;
  let connectPointerStartX = 0;
  let connectPointerStartY = 0;
  let connectPointerMoved = false;
  let suppressNextPortClick = false;
  let selectedConnectionId: string | null = null;

  function suppressPortClickOnce(): void {
    suppressNextPortClick = true;
    setTimeout(() => { suppressNextPortClick = false; }, 0);
  }

  function getPortCenter(portEl: HTMLElement): { x: number; y: number } {
    const canvasRect = canvasArea.getBoundingClientRect();
    const rect = portEl.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - canvasRect.left,
      y: rect.top + rect.height / 2 - canvasRect.top,
    };
  }

  function resolveConnection(
    startNodeId: string,
    startPortType: PortType,
    endNodeId: string,
    endPortType: PortType
  ): { from: string; to: string } | null {
    if (startNodeId === endNodeId) return null;
    if (startPortType === 'out' && endPortType === 'in') return { from: startNodeId, to: endNodeId };
    if (startPortType === 'in' && endPortType === 'out') return { from: endNodeId, to: startNodeId };
    return null;
  }

  function clearPortHighlights(): void {
    nodesContainer.querySelectorAll<HTMLElement>('.port').forEach(port => {
      port.classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
      port.style.transform = 'translateY(-50%)';
    });
  }

  function highlightConnectionTargets(draft: ConnectionDraft): void {
    clearPortHighlights();

    const startSelector = draft.portType === 'out' ? '.port-out' : '.port-in';
    const startPort = nodesContainer.querySelector<HTMLElement>(
      `.canvas-node[data-node-id="${draft.nodeId}"] ${startSelector}`
    );
    if (startPort) {
      startPort.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
      startPort.style.transform = 'translateY(-50%) scale(1.25)';
    }

    const targetSelector = draft.portType === 'out' ? '.port-in' : '.port-out';
    nodesContainer.querySelectorAll<HTMLElement>(targetSelector).forEach(port => {
      if (port.dataset.nodeId === draft.nodeId) return;
      port.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
      port.style.transform = 'translateY(-50%) scale(1.3)';
    });
  }

  function clearConnectionDraft(): void {
    if (tempLine) {
      tempLine.remove();
      tempLine = null;
    }
    connectionDraft = null;
    connectPointerMoved = false;
    clearPortHighlights();
  }

  function armConnectionFromPort(nodeId: string, portType: PortType): void {
    clearConnectionDraft();
    connectionDraft = { nodeId, portType, armedByClick: true };
    highlightConnectionTargets(connectionDraft);
  }

  function beginDragConnectionFromPort(portEl: HTMLElement, nodeId: string, portType: PortType, e: MouseEvent): void {
    clearConnectionDraft();
    connectionDraft = { nodeId, portType, armedByClick: false };
    connectPointerStartX = e.clientX;
    connectPointerStartY = e.clientY;
    connectPointerMoved = false;

    const start = getPortCenter(portEl);
    tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tempLine.setAttribute('x1', String(start.x));
    tempLine.setAttribute('y1', String(start.y));
    tempLine.setAttribute('x2', String(start.x));
    tempLine.setAttribute('y2', String(start.y));
    tempLine.setAttribute('stroke', '#23956F');
    tempLine.setAttribute('stroke-width', '2');
    tempLine.setAttribute('stroke-dasharray', '6,3');
    tempLine.setAttribute('opacity', '0.6');
    svgEl.appendChild(tempLine);
    highlightConnectionTargets(connectionDraft);
  }

  function getPortTypeFromElement(portEl: HTMLElement): PortType {
    return portEl.classList.contains('port-in') ? 'in' : 'out';
  }

  function tryCreateConnectionBetweenPorts(startDraft: ConnectionDraft, targetPort: HTMLElement): boolean {
    const targetNodeId = targetPort.dataset.nodeId;
    if (!targetNodeId) return false;

    const targetPortType = getPortTypeFromElement(targetPort);
    const resolved = resolveConnection(startDraft.nodeId, startDraft.portType, targetNodeId, targetPortType);
    if (!resolved) return false;

    const exists = project!.connections.some(c => c.from === resolved.from && c.to === resolved.to);
    if (!exists) {
      store.addConnection(projectId, resolved.from, resolved.to);
      drawConnections();
    }
    return true;
  }

  function getDistanceToConnection(pathEl: SVGPathElement, x: number, y: number): number {
    const totalLength = pathEl.getTotalLength();
    if (!Number.isFinite(totalLength) || totalLength <= 0) return Infinity;
    const samples = Math.max(24, Math.ceil(totalLength / 20));
    let minDistance = Infinity;
    for (let i = 0; i <= samples; i++) {
      const point = pathEl.getPointAtLength((i / samples) * totalLength);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < minDistance) minDistance = distance;
    }
    return minDistance;
  }

  function findConnectionNearPoint(clientX: number, clientY: number): { id: string; from: string; to: string; label?: string } | null {
    const canvasRect = canvasArea.getBoundingClientRect();
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;
    const INSERT_THRESHOLD_PX = 20;

    let bestMatch: { id: string; from: string; to: string; label?: string; distance: number } | null = null;
    for (const pathEl of svgEl.querySelectorAll<SVGPathElement>('path[data-connection-id][data-role="geometry"]')) {
      const id = pathEl.dataset.connectionId;
      const from = pathEl.dataset.fromNodeId;
      const to = pathEl.dataset.toNodeId;
      if (!id || !from || !to) continue;
      const distance = getDistanceToConnection(pathEl, x, y);
      if (distance > INSERT_THRESHOLD_PX) continue;
      if (!bestMatch || distance < bestMatch.distance) {
        const connection = project!.connections.find((item) => item.id === id);
        bestMatch = { id, from, to, label: connection?.label, distance };
      }
    }

    if (!bestMatch) return null;
    return { id: bestMatch.id, from: bestMatch.from, to: bestMatch.to, ...(bestMatch.label ? { label: bestMatch.label } : {}) };
  }

  function updateMiniMap(): void {
    if (!miniMapSvg || !miniMapNodesLayer || !miniMapViewport) return;

    const miniRect = miniMapSvg.getBoundingClientRect();
    const miniWidth = Math.max(1, miniRect.width);
    const miniHeight = Math.max(1, miniRect.height);

    const canvasRect = canvasArea.getBoundingClientRect();
    const viewportWorldX = -panX / zoom;
    const viewportWorldY = -panY / zoom;
    const viewportWorldWidth = canvasRect.width / zoom;
    const viewportWorldHeight = canvasRect.height / zoom;

    let minX = viewportWorldX;
    let minY = viewportWorldY;
    let maxX = viewportWorldX + viewportWorldWidth;
    let maxY = viewportWorldY + viewportWorldHeight;

    for (const node of project!.nodes) {
      const size = getNodeVisualSize(node);
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + size.width);
      maxY = Math.max(maxY, node.y + size.height);
    }

    minX -= MINIMAP_PADDING;
    minY -= MINIMAP_PADDING;
    maxX += MINIMAP_PADDING;
    maxY += MINIMAP_PADDING;

    const worldWidth = Math.max(1, maxX - minX);
    const worldHeight = Math.max(1, maxY - minY);
    const scale = Math.min(miniWidth / worldWidth, miniHeight / worldHeight);
    const offsetX = (miniWidth - worldWidth * scale) / 2;
    const offsetY = (miniHeight - worldHeight * scale) / 2;

    miniMapTransform = { minX, minY, scale, offsetX, offsetY };

    const toMiniX = (worldX: number): number => (worldX - minX) * scale + offsetX;
    const toMiniY = (worldY: number): number => (worldY - minY) * scale + offsetY;

    const nodeRects = project!.nodes.map(node => {
      const size = getNodeVisualSize(node);
      const x = toMiniX(node.x);
      const y = toMiniY(node.y);
      const width = Math.max(3, size.width * scale);
      const height = Math.max(2, size.height * scale);
      const styles = buildNodeColorStyles(readNodeColorMeta(node.meta));
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="1.5" fill="${styles.minimapFill}" stroke="${styles.minimapStroke}" stroke-width="0.8"></rect>`;
    }).join('');
    miniMapNodesLayer.innerHTML = nodeRects;

    miniMapViewport.setAttribute('x', String(toMiniX(viewportWorldX)));
    miniMapViewport.setAttribute('y', String(toMiniY(viewportWorldY)));
    miniMapViewport.setAttribute('width', String(Math.max(6, viewportWorldWidth * scale)));
    miniMapViewport.setAttribute('height', String(Math.max(6, viewportWorldHeight * scale)));
  }

  // -- Terminal and Agent Sync Setup --
  const terminalPanel = container.querySelector<HTMLElement>('#terminal-panel');
  const toggleTerminalBtn = container.querySelector<HTMLButtonElement>('#btn-toggle-terminal');
  let syncWs: WebSocket | null = null;
  let relayReconnectTimer: number | null = null;
  let relayStopped = false;

  const pushCanvasState = () => {
    if (syncWs?.readyState === WebSocket.OPEN) {
      syncWs.send(JSON.stringify({
        type: 'update_state',
        state: { nodes: project!.nodes, connections: project!.connections }
      }));
    }
  };

  const scheduleRelayReconnect = (): void => {
    if (relayStopped || !mcpRelayConfig.enabled) return;
    if (relayReconnectTimer !== null) return;
    relayReconnectTimer = window.setTimeout(() => {
      relayReconnectTimer = null;
      connectSyncWs();
    }, 2000);
  };

  const connectSyncWs = () => {
    if (relayStopped || !mcpRelayConfig.enabled) return;
    if (syncWs || !mcpRelayConfig.canvasSyncUrl) return;

    try {
      syncWs = new WebSocket(mcpRelayConfig.canvasSyncUrl);
    } catch (err) {
      console.error('Failed to open MCP relay websocket:', err);
      syncWs = null;
      scheduleRelayReconnect();
      return;
    }

    syncWs.addEventListener('open', () => pushCanvasState());

    syncWs.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'agent_action') {
          const payload = msg.payload;
          if (msg.action === 'add_node') {
            const newNode: PromptNode = {
              id: uid(),
              type: payload.type || 'default',
              label: payload.label || 'Agent Node',
              icon: 'auto_awesome',
              content: payload.content || '',
              meta: {},
              x: payload.x || 60,
              y: payload.y || 60,
            };
            store.addNode(projectId, newNode);
          } else if (msg.action === 'update_node_content') {
            store.updateNode(projectId, payload.nodeId, { content: payload.content });
          } else if (msg.action === 'create_connection') {
            store.addConnection(projectId, payload.fromId, payload.toId, payload.label || '');
          }
          renderNodes();
        }
      } catch (e) {
        console.error('Canvas sync message error:', e);
      }
    });

    syncWs.addEventListener('close', () => {
      syncWs = null;
      scheduleRelayReconnect();
    });

    syncWs.addEventListener('error', (event) => {
      console.error('Canvas relay websocket error:', event);
    });
  };

  if (!mcpRelayConfig.enabled && toggleTerminalBtn) {
    toggleTerminalBtn.disabled = true;
    toggleTerminalBtn.classList.add('opacity-40', 'cursor-not-allowed');
    toggleTerminalBtn.title = mcpRelayConfig.reason ?? 'MCP relay is disabled.';
  }

  connectSyncWs();
  registerTeardown(() => {
    relayStopped = true;
    if (relayReconnectTimer !== null) {
      window.clearTimeout(relayReconnectTimer);
      relayReconnectTimer = null;
    }
    if (syncWs) {
      syncWs.close();
      syncWs = null;
    }
  });

  function renderNodes(): void {
    clearConnectionDraft();
    nodesContainer.querySelectorAll('.canvas-node').forEach(el => el.remove());
    const hint = nodesContainer.querySelector('#empty-hint');
    if (project!.nodes.length > 0 && hint) hint.remove();

    for (const node of project!.nodes) {
      const size = getNodeVisualSize(node);
      const colorStyles = buildNodeColorStyles(readNodeColorMeta(node.meta));
      const el = document.createElement('div');
      el.className = 'canvas-node pointer-events-auto bg-white dark:bg-slate-900 border rounded-lg shadow-xl node-glow';
      el.dataset.nodeId = node.id;
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.style.width = `${size.width}px`;
      el.style.borderColor = colorStyles.border;
      el.innerHTML = `
        <div class="node-header p-3 flex items-center justify-between cursor-grab active:cursor-grabbing rounded-t-lg" style="background:${colorStyles.headerBackground}; border-bottom:1px solid ${colorStyles.headerBorder};">
          <h2 class="text-xs font-bold flex items-center gap-2 select-none min-w-0">
            <span class="material-icons text-sm" style="color:${colorStyles.icon};">${node.icon}</span>
            <span class="whitespace-nowrap">${escapeHTML(node.label)}</span>
          </h2>
          <div class="flex items-center gap-1">
            <button class="node-save-template text-slate-400 hover:text-primary p-0.5" title="Save as custom node template">
              <span class="material-icons text-xs">bookmark_add</span>
            </button>
            <button class="node-delete text-slate-400 hover:text-red-500 p-0.5" title="Delete node">
              <span class="material-icons text-xs">close</span>
            </button>
          </div>
        </div>
        <div class="relative">
          <!-- Input port (left side) -->
          <div class="port-in port absolute -left-[7px] top-1/2 -translate-y-1/2 z-10" data-node-id="${node.id}" title="Connect here (drag or click)"></div>
          <!-- Content preview -->
          <div class="p-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono leading-relaxed max-h-24 overflow-hidden">
            ${escapeHTML(node.content).substring(0, 120)}${node.content.length > 120 ? '…' : ''}
          </div>
          <!-- Output port (right side) -->
          <div class="port-out port absolute -right-[7px] top-1/2 -translate-y-1/2 z-10" data-node-id="${node.id}" title="Connect here (drag or click)"></div>
        </div>
        <div class="bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 flex justify-end items-center rounded-b-lg border-t" style="border-top-color:${colorStyles.footerBorder};">
          <span class="text-[9px] font-mono" style="color:${colorStyles.tokenText};">${node.content.length > 0 ? Math.ceil(node.content.length / 4) + ' tok' : 'empty'}</span>
        </div>
      `;
      nodesContainer.appendChild(el);

      // -- Dragging (by header only) ------
      let isDragging = false, didDrag = false, startX = 0, startY = 0, origX = node.x, origY = node.y;
      let dragListenersActive = false;
      const header = el.querySelector('.node-header') as HTMLElement;
      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
          didDrag = true;
        }
        node.x = origX + (e.clientX - startX) / zoom;
        node.y = origY + (e.clientY - startY) / zoom;
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        scheduleDrawConnections();
      };
      const disposeNodeDragListeners = (): void => {
        if (!dragListenersActive) return;
        dragListenersActive = false;
        isDragging = false;
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        activeNodeDragDisposers.delete(disposeNodeDragListeners);
      };
      const onMouseUp = (e: MouseEvent) => {
        if (!isDragging) {
          disposeNodeDragListeners();
          return;
        }

        isDragging = false;
        el.classList.remove('dragging');
        // Snap to 20px grid
        node.x = Math.round(node.x / 20) * 20;
        node.y = Math.round(node.y / 20) * 20;
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        store.updateNode(projectId, node.id, { x: node.x, y: node.y });

        // Shift+drop on an existing connection to reinsert this existing node elsewhere in the graph.
        if (e.shiftKey) {
          const connectionToSplit = findConnectionNearPoint(e.clientX, e.clientY);
          if (connectionToSplit && connectionToSplit.from !== node.id && connectionToSplit.to !== node.id) {
            const linkedConnections = project!.connections.filter(c => c.from === node.id || c.to === node.id);
            for (const conn of linkedConnections) {
              store.removeConnection(projectId, conn.id);
            }
            store.removeConnection(projectId, connectionToSplit.id);
            store.addConnection(projectId, connectionToSplit.from, node.id, connectionToSplit.label ?? '');
            store.addConnection(projectId, node.id, connectionToSplit.to);
          }
        }
        drawConnections();
        disposeNodeDragListeners();
      };
      header.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.node-delete, .node-save-template')) return;
        isDragging = true;
        didDrag = false;
        startX = e.clientX; startY = e.clientY;
        origX = node.x; origY = node.y;
        el.classList.add('dragging');
        if (!dragListenersActive) {
          dragListenersActive = true;
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
          activeNodeDragDisposers.add(disposeNodeDragListeners);
        }
        e.preventDefault();
      });

      // Port-based connection drawing (drag OR click-to-click)
      const inPort = el.querySelector('.port-in') as HTMLElement;
      const outPort = el.querySelector('.port-out') as HTMLElement;

      const wirePortConnection = (portEl: HTMLElement, portType: PortType): void => {
        portEl.addEventListener('mousedown', (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.preventDefault();
          if (connectionDraft?.armedByClick) return;
          beginDragConnectionFromPort(portEl, node.id, portType, e);
        });

        portEl.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          if (suppressNextPortClick) return;

          if (!connectionDraft) {
            armConnectionFromPort(node.id, portType);
            return;
          }

          if (!connectionDraft.armedByClick) return;

          const clickedStartPort =
            connectionDraft.nodeId === node.id &&
            connectionDraft.portType === portType;

          if (clickedStartPort) {
            clearConnectionDraft();
            return;
          }

          const created = tryCreateConnectionBetweenPorts(connectionDraft, portEl);
          if (created) {
            clearConnectionDraft();
            return;
          }

          // If the second click wasn't a compatible target, restart from that port.
          armConnectionFromPort(node.id, portType);
        });
      };

      wirePortConnection(inPort, 'in');
      wirePortConnection(outPort, 'out');

      // Single click node body -> open editor
      el.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.node-delete, .node-save-template, .port')) return;
        if (didDrag) {
          didDrag = false;
          return;
        }
        clearCanvasViewCleanup(container);
        router.navigate(`/project/${projectId}/editor/${node.id}`);
      });

      el.querySelector<HTMLButtonElement>('.node-save-template')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const input = await customPrompt('Template name:', node.label) ?? '';
        const templateLabel = input.trim();
        if (!templateLabel) return;
        store.saveCustomNodeTemplate({
          type: node.type,
          label: templateLabel,
          icon: node.icon,
          content: node.content,
          meta: { ...node.meta },
        });
        refreshSidebarBlocks();
      });

      // Delete button
      el.querySelector<HTMLButtonElement>('.node-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        store.removeNode(projectId, node.id);
        renderNodes();
      });
    }

    drawConnections();
    if (typeof pushCanvasState === 'function') pushCanvasState();
  }

  // Global mouse handlers for port connection
  addManagedListener(document, 'mousemove', (e: MouseEvent) => {
    if (!connectionDraft || !tempLine) return;
    if (Math.abs(e.clientX - connectPointerStartX) > 3 || Math.abs(e.clientY - connectPointerStartY) > 3) {
      connectPointerMoved = true;
    }
    const canvasRect = canvasArea.getBoundingClientRect();
    tempLine.setAttribute('x2', String(e.clientX - canvasRect.left));
    tempLine.setAttribute('y2', String(e.clientY - canvasRect.top));
  });

  addManagedListener(document, 'mouseup', (e: MouseEvent) => {
    if (!connectionDraft || !tempLine) return;

    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
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
      if (tempLine) {
        tempLine.remove();
        tempLine = null;
      }
      highlightConnectionTargets(connectionDraft);
      return;
    }

    clearConnectionDraft();
  });

  addManagedListener(document, 'mousedown', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (connectionDraft?.armedByClick && !target.closest('.port')) {
      clearConnectionDraft();
    }
    if (selectedConnectionId && !target.closest('.connector-hit')) {
      selectedConnectionId = null;
      drawConnections();
    }
  });

  async function editConnectionLabel(connectionId: string): Promise<void> {
    const connection = project!.connections.find((item) => item.id === connectionId);
    if (!connection) return;
    const nextLabel = await customPrompt('Branch label (optional):', connection.label ?? '');
    if (nextLabel === null) return;
    const normalized = normalizeConnectionLabel(nextLabel);
    store.updateConnectionLabel(projectId, connectionId, normalized);
    drawConnections();
  }

  addManagedListener(document, 'keydown', (e: KeyboardEvent) => {
    if (!selectedConnectionId) return;

    const target = e.target as HTMLElement | null;
    const isTypingTarget = target
      ? target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      : false;
    if (isTypingTarget) return;

    if (e.key === 'l' || e.key === 'L') {
      void editConnectionLabel(selectedConnectionId);
      e.preventDefault();
      return;
    }

    if (e.key !== 'Delete' && e.key !== 'Backspace') return;

    const selectedConnection = project!.connections.find(c => c.id === selectedConnectionId);
    if (!selectedConnection) {
      selectedConnectionId = null;
      drawConnections();
      return;
    }

    store.removeConnection(projectId, selectedConnection.id);
    selectedConnectionId = null;
    drawConnections();
    e.preventDefault();
  });

  function drawConnections(): void {
    svgEl.innerHTML = '';
    const canvasRect = canvasArea.getBoundingClientRect();
    let selectedConnectionStillExists = false;

    for (const conn of project!.connections) {
      const fromEl = nodesContainer.querySelector<HTMLElement>(`[data-node-id="${conn.from}"]`);
      const toEl = nodesContainer.querySelector<HTMLElement>(`[data-node-id="${conn.to}"]`);
      if (!fromEl || !toEl) continue;

      // Use port positions for more accurate connections
      const outPort = fromEl.querySelector('.port-out');
      const inPort = toEl.querySelector('.port-in');
      if (!outPort || !inPort) continue;

      const fromRect = outPort.getBoundingClientRect();
      const toRect = inPort.getBoundingClientRect();

      const x1 = fromRect.left + fromRect.width / 2 - canvasRect.left;
      const y1 = fromRect.top + fromRect.height / 2 - canvasRect.top;
      const x2 = toRect.left + toRect.width / 2 - canvasRect.left;
      const y2 = toRect.top + toRect.height / 2 - canvasRect.top;

      const dx = Math.abs(x2 - x1) * 0.5;
      const curve = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      const isSelected = conn.id === selectedConnectionId;
      if (isSelected) selectedConnectionStillExists = true;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', curve);
      path.setAttribute('stroke', '#23956F');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.dataset.connectionId = conn.id;
      path.dataset.fromNodeId = conn.from;
      path.dataset.toNodeId = conn.to;
      path.dataset.role = 'geometry';
      path.classList.add('connector-path');
      if (isSelected) path.classList.add('connector-path-selected');
      path.style.pointerEvents = 'none';

      // Wide transparent path for reliable click targets.
      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitPath.setAttribute('d', curve);
      // Use near-transparent painted stroke so hit-testing works consistently across browsers.
      hitPath.setAttribute('stroke', '#23956F');
      hitPath.setAttribute('stroke-opacity', '0.001');
      hitPath.setAttribute('stroke-width', '14');
      hitPath.setAttribute('stroke-linecap', 'round');
      hitPath.setAttribute('fill', 'none');
      hitPath.classList.add('connector-hit');
      hitPath.style.cursor = 'pointer';
      hitPath.style.pointerEvents = 'all';
      hitPath.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        selectedConnectionId = selectedConnectionId === conn.id ? null : conn.id;
        drawConnections();
      });
      hitPath.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        selectedConnectionId = conn.id;
        drawConnections();
      });
      hitPath.addEventListener('dblclick', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        selectedConnectionId = conn.id;
        void editConnectionLabel(conn.id);
      });
      svgEl.appendChild(hitPath);
      svgEl.appendChild(path);

      const connectionLabel = normalizeConnectionLabel(conn.label ?? '');
      if (connectionLabel) {
        const pathLength = path.getTotalLength();
        if (Number.isFinite(pathLength) && pathLength > 0) {
          const midpoint = path.getPointAtLength(pathLength / 2);
          const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          labelText.textContent = connectionLabel;
          labelText.setAttribute('x', String(midpoint.x));
          labelText.setAttribute('y', String(midpoint.y - 8));
          labelText.setAttribute('font-size', '10');
          labelText.setAttribute('font-weight', isSelected ? '700' : '600');
          labelText.setAttribute('text-anchor', 'middle');
          labelText.setAttribute('fill', isSelected ? '#0f766e' : '#1f2937');
          labelText.style.pointerEvents = 'none';
          svgEl.appendChild(labelText);

          const labelBox = labelText.getBBox();
          const labelBackground = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          labelBackground.setAttribute('x', String(labelBox.x - 4));
          labelBackground.setAttribute('y', String(labelBox.y - 2));
          labelBackground.setAttribute('width', String(labelBox.width + 8));
          labelBackground.setAttribute('height', String(labelBox.height + 4));
          labelBackground.setAttribute('rx', '4');
          labelBackground.setAttribute('fill', isSelected ? 'rgba(20, 184, 166, 0.20)' : 'rgba(255,255,255,0.92)');
          labelBackground.setAttribute('stroke', isSelected ? 'rgba(15, 118, 110, 0.45)' : 'rgba(31,41,55,0.25)');
          labelBackground.style.pointerEvents = 'none';
          svgEl.insertBefore(labelBackground, labelText);
        }
      }

      // Dots at endpoints
      for (const [cx, cy] of [[x1, y1], [x2, y2]]) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', '#23956F');
        circle.style.pointerEvents = 'none';
        svgEl.appendChild(circle);
      }

      // Animated flow dot along the path
      const flowDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      flowDot.setAttribute('r', '3');
      flowDot.setAttribute('fill', '#23956F');
      flowDot.setAttribute('opacity', '0.7');
      flowDot.style.pointerEvents = 'none';
      const animateMotion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
      animateMotion.setAttribute('dur', '3s');
      animateMotion.setAttribute('repeatCount', 'indefinite');
      animateMotion.setAttribute('path', curve);
      flowDot.appendChild(animateMotion);
      svgEl.appendChild(flowDot);
    }

    if (selectedConnectionId && !selectedConnectionStillExists) {
      selectedConnectionId = null;
    }
    updateMiniMap();
  }

  applyViewportTransform();
  renderNodes();

  // -- Viewport controls: right-click drag pan + button zoom --
  let isPanning = false;
  let panStartMouseX = 0;
  let panStartMouseY = 0;
  let panStartX = 0;
  let panStartY = 0;

  canvasArea.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
  });

  canvasArea.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 2) return;
    isPanning = true;
    panStartMouseX = e.clientX;
    panStartMouseY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    canvasArea.classList.add('cursor-grabbing');
    e.preventDefault();
  });

  addManagedListener(document, 'mousemove', (e: MouseEvent) => {
    if (!isPanning) return;
    panX = panStartX + (e.clientX - panStartMouseX);
    panY = panStartY + (e.clientY - panStartMouseY);
    applyViewportTransform();
    scheduleDrawConnections();
  });

  addManagedListener(document, 'mouseup', () => {
    if (!isPanning) return;
    isPanning = false;
    canvasArea.classList.remove('cursor-grabbing');
  });

  const zoomInBtn = container.querySelector<HTMLButtonElement>('#btn-zoom-in');
  const zoomOutBtn = container.querySelector<HTMLButtonElement>('#btn-zoom-out');
  const helpBtn = container.querySelector<HTMLButtonElement>('#btn-canvas-help');
  const helpPanel = container.querySelector<HTMLElement>('#canvas-help-panel');
  const helpCloseBtn = container.querySelector<HTMLButtonElement>('#btn-canvas-help-close');
  const zoomAroundViewportCenter = (delta: number): void => {
    const rect = canvasArea.getBoundingClientRect();
    zoomAt(zoom + delta, rect.width / 2, rect.height / 2);
  };
  zoomInBtn?.addEventListener('click', () => zoomAroundViewportCenter(ZOOM_STEP));
  zoomOutBtn?.addEventListener('click', () => zoomAroundViewportCenter(-ZOOM_STEP));

  miniMapEl?.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (!miniMapTransform) return;
    const miniRect = miniMapEl.getBoundingClientRect();
    const localX = e.clientX - miniRect.left;
    const localY = e.clientY - miniRect.top;
    const worldX = (localX - miniMapTransform.offsetX) / miniMapTransform.scale + miniMapTransform.minX;
    const worldY = (localY - miniMapTransform.offsetY) / miniMapTransform.scale + miniMapTransform.minY;
    const canvasRect = canvasArea.getBoundingClientRect();
    panX = canvasRect.width / 2 - worldX * zoom;
    panY = canvasRect.height / 2 - worldY * zoom;
    applyViewportTransform();
    drawConnections();
    e.preventDefault();
    e.stopPropagation();
  });

  let helpPanelOpen = false;
  const setHelpPanelOpen = (open: boolean): void => {
    helpPanelOpen = open;
    helpPanel?.classList.toggle('hidden', !open);
    if (helpBtn) {
      helpBtn.setAttribute('aria-expanded', String(open));
      helpBtn.classList.toggle('text-primary', open);
      helpBtn.classList.toggle('bg-primary/10', open);
    }
  };

  helpBtn?.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHelpPanelOpen(!helpPanelOpen);
  });

  helpCloseBtn?.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHelpPanelOpen(false);
  });

  addManagedListener(document, 'click', (e: MouseEvent) => {
    if (!helpPanelOpen) return;
    const target = e.target as HTMLElement;
    if (target.closest('#canvas-help-panel') || target.closest('#btn-canvas-help')) return;
    setHelpPanelOpen(false);
  });

  // Mouse wheel / trackpad zoom around cursor
  canvasArea.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const rect = canvasArea.getBoundingClientRect();
    const focalX = e.clientX - rect.left;
    const focalY = e.clientY - rect.top;
    // Exponential scaling feels smoother across mouse wheels and trackpads.
    const sensitivity = e.ctrlKey ? 0.0025 : 0.0012;
    const scaleFactor = Math.exp(-normalizeWheelDelta(e) * sensitivity);
    zoomAt(zoom * scaleFactor, focalX, focalY);
  }, { passive: false });

  interface SidebarBlockData {
    type: PromptNode['type'];
    label: string;
    icon: string;
    defaultContent: string;
    meta: Record<string, string>;
  }

  const sidebarBlocksHost = container.querySelector<HTMLElement>('#sidebar-blocks');
  const sidebarSearch = container.querySelector<HTMLInputElement>('#sidebar-search');
  const sidebar = container.querySelector<HTMLElement>('#canvas-sidebar');
  const sidebarResizeHandle = container.querySelector<HTMLElement>('#canvas-sidebar-resize-handle');
  const canvasMain = container.querySelector<HTMLElement>('#canvas-main');
  const collapseSidebarBtn = container.querySelector<HTMLButtonElement>('#btn-collapse-canvas-sidebar');
  const openSidebarBtn = container.querySelector<HTMLButtonElement>('#btn-open-canvas-sidebar');
  let sidebarCollapsed = initialSidebarCollapsed;
  let sidebarWidth = initialSidebarWidth;

  const clampSidebarWidth = (candidateWidth: number): number => {
    const hostWidth = canvasMain?.clientWidth ?? window.innerWidth;
    const maxForViewport = Math.max(MIN_CANVAS_SIDEBAR_WIDTH, hostWidth - 140);
    const maxWidth = Math.min(MAX_CANVAS_SIDEBAR_WIDTH, maxForViewport);
    return Math.max(MIN_CANVAS_SIDEBAR_WIDTH, Math.min(maxWidth, candidateWidth));
  };

  const applySidebarWidthState = (): void => {
    if (!canvasMain) return;
    const boundedWidth = clampSidebarWidth(sidebarWidth);
    if (boundedWidth !== sidebarWidth) {
      sidebarWidth = boundedWidth;
      writeCanvasSidebarWidthState(projectId, sidebarWidth);
    }
    canvasMain.style.setProperty('--canvas-sidebar-current-width', `${Math.round(sidebarWidth)}px`);
  };

  const applySidebarCollapsedState = (): void => {
    if (!sidebar) return;
    sidebar.classList.toggle('is-collapsed', sidebarCollapsed);
    if (collapseSidebarBtn) {
      collapseSidebarBtn.classList.toggle('hidden', sidebarCollapsed);
      collapseSidebarBtn.setAttribute('aria-expanded', String(!sidebarCollapsed));
    }
    if (openSidebarBtn) {
      openSidebarBtn.classList.toggle('hidden', !sidebarCollapsed);
      openSidebarBtn.setAttribute('aria-expanded', String(!sidebarCollapsed));
    }
    requestAnimationFrame(() => {
      scheduleDrawConnections();
    });
  };

  applySidebarWidthState();
  applySidebarCollapsedState();
  collapseSidebarBtn?.addEventListener('click', () => {
    sidebarCollapsed = true;
    writeCanvasSidebarCollapsedState(projectId, sidebarCollapsed);
    applySidebarCollapsedState();
  });
  openSidebarBtn?.addEventListener('click', () => {
    sidebarCollapsed = false;
    writeCanvasSidebarCollapsedState(projectId, sidebarCollapsed);
    applySidebarCollapsedState();
  });

  let stopSidebarResizeDrag: (() => void) | null = null;
  const beginSidebarResizeDrag = (event: MouseEvent): void => {
    if (event.button !== 0 || sidebarCollapsed) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add('canvas-sidebar-resizing');

    const onPointerMove = (moveEvent: MouseEvent): void => {
      const deltaX = moveEvent.clientX - startX;
      sidebarWidth = clampSidebarWidth(startWidth + deltaX);
      writeCanvasSidebarWidthState(projectId, sidebarWidth);
      applySidebarWidthState();
      scheduleDrawConnections();
    };

    const onPointerUp = (): void => {
      document.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('mouseup', onPointerUp);
      document.body.classList.remove('canvas-sidebar-resizing');
      stopSidebarResizeDrag = null;
    };

    stopSidebarResizeDrag = (): void => {
      document.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('mouseup', onPointerUp);
      document.body.classList.remove('canvas-sidebar-resizing');
      stopSidebarResizeDrag = null;
    };

    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
  };
  sidebarResizeHandle?.addEventListener('mousedown', beginSidebarResizeDrag);
  registerTeardown(() => {
    stopSidebarResizeDrag?.();
  });

  addManagedListener(window, 'resize', () => {
    applySidebarWidthState();
    scheduleDrawConnections();
  });

  function parseSidebarBlockData(block: HTMLElement): SidebarBlockData {
    let parsedMeta: Record<string, string> = {};
    try {
      const rawMeta = decodeURIComponent(block.dataset.meta ?? '');
      const candidate = JSON.parse(rawMeta) as unknown;
      if (
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        Object.values(candidate as Record<string, unknown>).every((value) => typeof value === 'string')
      ) {
        parsedMeta = candidate as Record<string, string>;
      }
    } catch {
      parsedMeta = {};
    }

    return {
      type: (block.dataset.type ?? 'custom') as PromptNode['type'],
      label: block.dataset.label ?? 'Custom Node',
      icon: block.dataset.icon ?? 'widgets',
      defaultContent: decodeURIComponent(block.dataset.default ?? ''),
      meta: parsedMeta,
    };
  }

  function createNodeFromBlockData(blockData: SidebarBlockData, location?: { x: number; y: number }): void {
    let nodeX = 60;
    let nodeY = 60;

    if (location) {
      nodeX = location.x;
      nodeY = location.y;
    } else {
      for (const existingNode of project!.nodes) {
        const size = getNodeVisualSize(existingNode);
        const nextX = existingNode.x + size.width + 56;
        if (nextX > nodeX) {
          nodeX = nextX;
          nodeY = existingNode.y;
        }
      }
    }

    const node: PromptNode = {
      id: uid(),
      type: blockData.type,
      label: blockData.label,
      icon: blockData.icon,
      x: nodeX,
      y: nodeY,
      content: blockData.defaultContent,
      meta: { ...blockData.meta },
    };
    store.addNode(projectId, node);
    renderNodes();
  }

  function applySidebarFilter(): void {
    const query = sidebarSearch?.value.toLowerCase().trim() ?? '';
    container.querySelectorAll<HTMLElement>('.sidebar-block').forEach((block) => {
      const label = block.dataset.label?.toLowerCase() ?? '';
      block.style.display = label.includes(query) ? '' : 'none';
    });
  }

  function wireSidebarBlocks(): void {
    container.querySelectorAll<HTMLElement>('.sidebar-block').forEach((block) => {
      block.addEventListener('dragstart', (e: DragEvent) => {
        e.dataTransfer?.setData('text/plain', JSON.stringify(parseSidebarBlockData(block)));
      });

      block.addEventListener('click', (event: MouseEvent) => {
        if ((event.target as HTMLElement).closest('.sidebar-custom-delete')) return;
        createNodeFromBlockData(parseSidebarBlockData(block));
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.sidebar-custom-delete').forEach((button) => {
      button.addEventListener('click', async (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const templateId = button.dataset.templateId;
        if (!templateId) return;
        if (!(await customConfirm('Delete this custom node template?'))) return;
        store.removeCustomNodeTemplate(templateId);
        refreshSidebarBlocks();
      });
    });
  }

  function refreshSidebarBlocks(): void {
    if (!sidebarBlocksHost) return;
    const nextCategories = buildSidebarCategories(store.getCustomNodeTemplates());
    sidebarBlocksHost.innerHTML = renderSidebarBlocksHTML(nextCategories);
    wireSidebarBlocks();
    applySidebarFilter();
  }

  wireSidebarBlocks();

  canvasArea.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    canvasArea.classList.add('ring-2', 'ring-primary/30', 'ring-inset');
  });
  canvasArea.addEventListener('dragleave', () => {
    canvasArea.classList.remove('ring-2', 'ring-primary/30', 'ring-inset');
  });
  canvasArea.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    canvasArea.classList.remove('ring-2', 'ring-primary/30', 'ring-inset');
    const data = e.dataTransfer?.getData('text/plain');
    if (!data) return;
    try {
      const blockData = JSON.parse(data) as SidebarBlockData;
      const connectionToSplit = findConnectionNearPoint(e.clientX, e.clientY);
      const worldPoint = screenToWorld(e.clientX, e.clientY);
      const newNodeSize: NodeVisualSize = {
        width: Math.max(NODE_MIN_WIDTH, estimateLabelPixelWidth(String(blockData.label ?? '')) + NODE_DECORATION_WIDTH),
        height: NODE_VISUAL_HEIGHT,
      };
      // Snap to 20px grid
      const rawX = worldPoint.x - newNodeSize.width / 2;
      const rawY = worldPoint.y - newNodeSize.height / 2;
      const location = {
        x: Math.round(rawX / 20) * 20,
        y: Math.round(rawY / 20) * 20,
      };
      const node: PromptNode = {
        id: uid(),
        type: blockData.type,
        label: blockData.label,
        icon: blockData.icon,
        x: location.x,
        y: location.y,
        content: blockData.defaultContent,
        meta: { ...blockData.meta },
      };
      store.addNode(projectId, node);

      // If dropped on an existing connection, split it and insert the new node between.
      if (connectionToSplit) {
        store.removeConnection(projectId, connectionToSplit.id);
        store.addConnection(projectId, connectionToSplit.from, node.id, connectionToSplit.label ?? '');
        store.addConnection(projectId, node.id, connectionToSplit.to);
      }

      renderNodes();
    } catch { /* ignore bad data */ }
  });

  // -- Sidebar search --
  sidebarSearch?.addEventListener('input', () => {
    applySidebarFilter();
  });

  // -- Navigation --
  container.querySelector('#nav-home')?.addEventListener('click', () => {
    clearCanvasViewCleanup(container);
    router.navigate('/');
  });
  container.querySelector('#crumb-home')?.addEventListener('click', () => {
    clearCanvasViewCleanup(container);
    router.navigate('/');
  });
  wireProjectViewTabs(container, projectId, { beforeNavigate: () => clearCanvasViewCleanup(container) });

  // -- Save prompt snapshot for diff/history --
  container.querySelector('#btn-save-snapshot')?.addEventListener('click', () => {
    const version = store.saveCurrentState(projectId);
    const btn = container.querySelector<HTMLButtonElement>('#btn-save-snapshot');
    if (!btn) return;
    btn.innerHTML = version
      ? '<span class="material-icons text-sm">check</span> State saved'
      : '<span class="material-icons text-sm">info</span> No changes';
    setTimeout(() => {
      btn.innerHTML = '<span class="material-icons text-sm">save</span> Save Current State';
    }, 2000);
  });

  // -- Copy prompt output (runtime and flow template) --
  const wireCopyButton = (
    selector: string,
    mode: 'runtime' | 'flow-template',
    idleHTML: string,
  ): void => {
    container.querySelector(selector)?.addEventListener('click', () => {
      const assembled = store.assemblePrompt(projectId, mode);
      navigator.clipboard.writeText(assembled).then(() => {
        const btn = container.querySelector<HTMLElement>(selector);
        if (!btn) return;
        btn.innerHTML = '<span class="material-icons text-sm">check</span> Copied!';
        setTimeout(() => {
          btn.innerHTML = idleHTML;
        }, 2000);
      });
    });
  };

  wireCopyButton(
    '#btn-copy-runtime',
    'runtime',
    '<span class="material-icons text-sm">content_copy</span> Copy Runtime',
  );
  wireCopyButton(
    '#btn-copy-flow',
    'flow-template',
    '<span class="material-icons text-sm">account_tree</span> Copy Flow Template',
  );

  // Handle UI opening manually if needed, but the click listener handles it.

  toggleTerminalBtn?.addEventListener('click', (e) => {
    if (!mcpRelayConfig.enabled) return;
    e.preventDefault();
    e.stopPropagation();

    const isHidden = terminalPanel?.classList.contains('hidden');

    if (isHidden) {
      terminalPanel?.classList.remove('hidden');
      requestAnimationFrame(() => {
        terminalPanel?.setAttribute('data-open', 'true');
      });
    } else {
      terminalPanel?.removeAttribute('data-open');
      setTimeout(() => terminalPanel?.classList.add('hidden'), 300);
    }
  });

  container.querySelector('#btn-terminal-close')?.addEventListener('click', () => {
    if (terminalPanel) {
      terminalPanel.removeAttribute('data-open');
      setTimeout(() => terminalPanel.classList.add('hidden'), 300);
    }
  });

  // Theme toggle
  wireThemeToggle(container);
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

