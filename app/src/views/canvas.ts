/**
 * Canvas View — Node graph editor with drag/drop (matches page2.html mockup)
 */
import { store } from '../store';
import { router } from '../router';
import { BLOCK_PALETTE, PromptNode, uid } from '../models';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { clearProjectEscapeToCanvas, projectViewTabsHTML, wireProjectViewTabs } from './project-nav';

export function renderCanvas(container: HTMLElement, projectId: string): void {
  const project = store.getProject(projectId);
  if (!project) { router.navigate('/'); return; }
  clearProjectEscapeToCanvas(container);

  // Group palette blocks by category
  const categories = new Map<string, typeof BLOCK_PALETTE>();
  for (const b of BLOCK_PALETTE) {
    if (!categories.has(b.category)) categories.set(b.category, []);
    categories.get(b.category)!.push(b);
  }

  container.innerHTML = `
    <!-- Top Navigation Bar -->
    <header class="h-14 border-b border-primary/10 relative flex items-center px-4 bg-white dark:bg-background-dark/80 z-20">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-3 shrink-0">
          <button type="button" class="h-10 w-10 flex items-center justify-center cursor-pointer rounded shrink-0" id="nav-home" aria-label="Go to dashboard">
            <img src="/Icon.svg" alt="Spoqen" class="h-10 w-10 object-contain" />
          </button>
          <div>
            <h1 class="text-sm font-semibold leading-none">${project.name}</h1>
            <span class="text-[10px] text-slate-400 uppercase tracking-wider">Visual Prompt Editor</span>
          </div>
        </div>
        <div class="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-2"></div>
        <div class="flex items-center gap-1 text-xs text-slate-500">
          <span class="material-icons text-sm">cloud_done</span>
          <span>Saved</span>
        </div>
      </div>
      <div class="absolute left-1/2 -translate-x-1/2">
        ${projectViewTabsHTML('canvas')}
      </div>
      <div class="ml-auto flex items-center gap-3">
        ${themeToggleHTML()}
        <button id="btn-export" class="px-4 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary/90 rounded transition-colors flex items-center gap-2">
          <span class="material-icons text-sm">content_copy</span> Copy Assembled
        </button>
      </div>
    </header>

    <main class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Sidebar -->
      <aside class="w-64 border-r border-primary/10 bg-white dark:bg-background-dark/50 flex flex-col z-10 shrink-0">
        <div class="p-4 border-b border-primary/5">
          <div class="relative">
            <span class="material-icons absolute left-2.5 top-2.5 text-slate-400 text-sm">search</span>
            <input id="sidebar-search" class="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all" placeholder="Search blocks..." type="text" />
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-4 custom-scrollbar" id="sidebar-blocks">
          ${[...categories.entries()].map(([cat, blocks]) => `
            <section data-category="${cat}">
              <h3 class="px-2 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">${cat}</h3>
              <div class="space-y-1">
                ${blocks.map(b => `
                  <div class="sidebar-block group flex items-center gap-3 p-2 rounded cursor-grab hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-primary/20"
                       draggable="true" data-type="${b.type}" data-label="${b.label}" data-icon="${b.icon}" data-default="${encodeURIComponent(b.defaultContent)}">
                    <span class="material-icons text-sm text-primary">${b.icon}</span>
                    <span class="text-xs font-medium">${b.label}</span>
                  </div>
                `).join('')}
              </div>
            </section>
          `).join('')}
        </div>
        <div class="p-4 border-t border-primary/5 bg-slate-50 dark:bg-white/5">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
            <span class="text-[10px] font-medium text-slate-500 uppercase">${project.nodes.length} Nodes</span>
          </div>
        </div>
      </aside>

      <!-- Main Canvas Area -->
      <div id="canvas-area" class="flex-1 relative overflow-hidden bg-background-light dark:bg-background-dark canvas-grid">
        <!-- Breadcrumbs -->
        <div class="absolute top-4 left-6 flex items-center gap-2 text-xs font-medium text-slate-400 bg-white/80 dark:bg-background-dark/80 px-3 py-1.5 rounded-full border border-primary/10 shadow-sm z-10">
          <span class="cursor-pointer hover:text-primary" id="crumb-home">Projects</span>
          <span class="material-icons text-[10px]">chevron_right</span>
          <span class="text-slate-800 dark:text-slate-200">${project.name}</span>
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
        <div id="canvas-help-panel" class="hidden absolute bottom-24 right-6 w-80 bg-white/95 dark:bg-slate-900/95 border border-primary/20 rounded-xl shadow-2xl backdrop-blur-sm z-20">
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
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Drop a new block on a connection:</span> Insert it between nodes.</div>
            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Shift + drag a node, then drop on a connection:</span> Reinsert it elsewhere.</div>
          </div>
        </div>

        <!-- Floating Controls -->
        <div class="absolute bottom-6 right-6 flex items-center gap-2 z-10">
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
        <div id="minimap" class="absolute bottom-6 left-6 w-32 h-24 bg-white/65 dark:bg-slate-900/65 border border-primary/15 rounded-lg overflow-hidden backdrop-blur-sm z-10">
          <svg id="minimap-svg" class="w-full h-full block">
            <rect id="minimap-bg" x="0" y="0" width="100%" height="100%" fill="transparent"></rect>
            <g id="minimap-nodes"></g>
            <rect id="minimap-viewport" x="0" y="0" width="0" height="0" rx="1.5" fill="rgba(14, 165, 233, 0.16)" stroke="#0ea5e9" stroke-width="1"></rect>
          </svg>
          <div class="pointer-events-none absolute bottom-1 right-1 text-[8px] text-slate-400 uppercase font-bold">MiniMap</div>
        </div>
      </div>

      <!-- Right Properties Panel (Collapsed) -->
      <aside class="w-12 border-l border-primary/10 bg-white dark:bg-background-dark/50 flex flex-col items-center py-4 gap-4 shrink-0">
        <button class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/5 rounded transition-all" title="Properties">
          <span class="material-icons text-lg">tune</span>
        </button>
        <button class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-primary hover:bg-primary/5 rounded transition-all" title="Variables">
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

  // ── Render existing nodes ───────────
  const canvasArea = container.querySelector<HTMLElement>('#canvas-area')!;
  const nodesContainer = container.querySelector<HTMLElement>('#nodes-container')!;
  const svgEl = container.querySelector<SVGSVGElement>('#connection-svg')!;
  const miniMapEl = container.querySelector<HTMLElement>('#minimap');
  const miniMapSvg = container.querySelector<SVGSVGElement>('#minimap-svg');
  const miniMapNodesLayer = container.querySelector<SVGGElement>('#minimap-nodes');
  const miniMapViewport = container.querySelector<SVGRectElement>('#minimap-viewport');

  // Viewport (world -> screen): screen = world * zoom + pan
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 2.5;
  const ZOOM_STEP = 0.12;
  const NODE_VISUAL_WIDTH = 224;
  const NODE_VISUAL_HEIGHT = 140;
  const MINIMAP_PADDING = 80;
  let zoom = 1;
  let panX = 0;
  let panY = 0;

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

  function applyViewportTransform(): void {
    nodesContainer.style.transformOrigin = '0 0';
    nodesContainer.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
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
    drawConnections();
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

  function findConnectionNearPoint(clientX: number, clientY: number): { id: string; from: string; to: string } | null {
    const canvasRect = canvasArea.getBoundingClientRect();
    const x = clientX - canvasRect.left;
    const y = clientY - canvasRect.top;
    const INSERT_THRESHOLD_PX = 20;

    let bestMatch: { id: string; from: string; to: string; distance: number } | null = null;
    for (const pathEl of svgEl.querySelectorAll<SVGPathElement>('path[data-connection-id][data-role="geometry"]')) {
      const id = pathEl.dataset.connectionId;
      const from = pathEl.dataset.fromNodeId;
      const to = pathEl.dataset.toNodeId;
      if (!id || !from || !to) continue;
      const distance = getDistanceToConnection(pathEl, x, y);
      if (distance > INSERT_THRESHOLD_PX) continue;
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { id, from, to, distance };
      }
    }

    if (!bestMatch) return null;
    return { id: bestMatch.id, from: bestMatch.from, to: bestMatch.to };
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
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + NODE_VISUAL_WIDTH);
      maxY = Math.max(maxY, node.y + NODE_VISUAL_HEIGHT);
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
      const x = toMiniX(node.x);
      const y = toMiniY(node.y);
      const width = Math.max(3, NODE_VISUAL_WIDTH * scale);
      const height = Math.max(2, NODE_VISUAL_HEIGHT * scale);
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="1.5" fill="rgba(35,149,111,0.45)" stroke="rgba(35,149,111,0.85)" stroke-width="0.8"></rect>`;
    }).join('');
    miniMapNodesLayer.innerHTML = nodeRects;

    miniMapViewport.setAttribute('x', String(toMiniX(viewportWorldX)));
    miniMapViewport.setAttribute('y', String(toMiniY(viewportWorldY)));
    miniMapViewport.setAttribute('width', String(Math.max(6, viewportWorldWidth * scale)));
    miniMapViewport.setAttribute('height', String(Math.max(6, viewportWorldHeight * scale)));
  }

  function renderNodes(): void {
    clearConnectionDraft();
    nodesContainer.querySelectorAll('.canvas-node').forEach(el => el.remove());
    const hint = nodesContainer.querySelector('#empty-hint');
    if (project!.nodes.length > 0 && hint) hint.remove();

    for (const node of project!.nodes) {
      const el = document.createElement('div');
      el.className = 'canvas-node pointer-events-auto bg-white dark:bg-slate-900 border border-primary/40 rounded-lg shadow-xl node-glow w-56';
      el.dataset.nodeId = node.id;
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.innerHTML = `
        <div class="node-header bg-primary/10 border-b border-primary/20 p-3 flex items-center justify-between cursor-grab active:cursor-grabbing rounded-t-lg">
          <h2 class="text-xs font-bold flex items-center gap-2 select-none">
            <span class="material-icons text-sm text-primary">${node.icon}</span>
            ${node.label}
          </h2>
          <button class="node-delete text-slate-400 hover:text-red-500 p-0.5" title="Delete node">
            <span class="material-icons text-xs">close</span>
          </button>
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
        <div class="bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 flex justify-between items-center rounded-b-lg border-t border-primary/10">
          <span class="text-[9px] text-slate-400 uppercase font-medium tracking-wider">${node.type}</span>
          <span class="text-[9px] text-primary/60 font-mono">${node.content.length > 0 ? Math.ceil(node.content.length / 4) + ' tok' : 'empty'}</span>
        </div>
      `;
      nodesContainer.appendChild(el);

      // ── Dragging (by header only) ──────
      let isDragging = false, didDrag = false, startX = 0, startY = 0, origX = node.x, origY = node.y;
      const header = el.querySelector('.node-header') as HTMLElement;
      header.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.node-delete')) return;
        isDragging = true;
        didDrag = false;
        startX = e.clientX; startY = e.clientY;
        origX = node.x; origY = node.y;
        el.classList.add('dragging');
        e.preventDefault();
      });
      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
          didDrag = true;
        }
        node.x = origX + (e.clientX - startX) / zoom;
        node.y = origY + (e.clientY - startY) / zoom;
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        drawConnections();
      };
      const onMouseUp = (e: MouseEvent) => {
        if (isDragging) {
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
              store.addConnection(projectId, connectionToSplit.from, node.id);
              store.addConnection(projectId, node.id, connectionToSplit.to);
            }
          }
          drawConnections();
        }
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

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
        if ((e.target as HTMLElement).closest('.node-delete, .port')) return;
        if (didDrag) {
          didDrag = false;
          return;
        }
        router.navigate(`/project/${projectId}/editor/${node.id}`);
      });

      // Delete button
      el.querySelector<HTMLButtonElement>('.node-delete')?.addEventListener('click', (e) => {
        e.stopPropagation();
        store.removeNode(projectId, node.id);
        renderNodes();
      });
    }

    drawConnections();
  }

  // Global mouse handlers for port connection
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!connectionDraft || !tempLine) return;
    if (Math.abs(e.clientX - connectPointerStartX) > 3 || Math.abs(e.clientY - connectPointerStartY) > 3) {
      connectPointerMoved = true;
    }
    const canvasRect = canvasArea.getBoundingClientRect();
    tempLine.setAttribute('x2', String(e.clientX - canvasRect.left));
    tempLine.setAttribute('y2', String(e.clientY - canvasRect.top));
  });

  document.addEventListener('mouseup', (e: MouseEvent) => {
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

  document.addEventListener('mousedown', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (connectionDraft?.armedByClick && !target.closest('.port')) {
      clearConnectionDraft();
    }
    if (selectedConnectionId && !target.closest('.connector-hit')) {
      selectedConnectionId = null;
      drawConnections();
    }
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!selectedConnectionId) return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;

    const target = e.target as HTMLElement | null;
    const isTypingTarget = target
      ? target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      : false;
    if (isTypingTarget) return;

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
      svgEl.appendChild(hitPath);
      svgEl.appendChild(path);

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

  // ── Viewport controls: right-click drag pan + button zoom ──
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

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isPanning) return;
    panX = panStartX + (e.clientX - panStartMouseX);
    panY = panStartY + (e.clientY - panStartMouseY);
    applyViewportTransform();
    drawConnections();
  });

  document.addEventListener('mouseup', () => {
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

  document.addEventListener('click', (e: MouseEvent) => {
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
    const scaleFactor = Math.exp(-e.deltaY * sensitivity);
    zoomAt(zoom * scaleFactor, focalX, focalY);
  }, { passive: false });

  window.addEventListener('resize', () => {
    drawConnections();
  });

  // ── Sidebar: drag-and-drop AND click-to-add ──
  container.querySelectorAll<HTMLElement>('.sidebar-block').forEach(block => {
    // Drag to canvas
    block.addEventListener('dragstart', (e: DragEvent) => {
      e.dataTransfer?.setData('text/plain', JSON.stringify({
        type: block.dataset.type,
        label: block.dataset.label,
        icon: block.dataset.icon,
        defaultContent: decodeURIComponent(block.dataset.default ?? ''),
      }));
    });

    // Click to add at a smart position
    block.addEventListener('click', () => {
      const blockData = {
        type: block.dataset.type!,
        label: block.dataset.label!,
        icon: block.dataset.icon!,
        defaultContent: decodeURIComponent(block.dataset.default ?? ''),
      };
      // Place new node to the right of the rightmost existing node
      let maxX = 60, maxY = 60;
      for (const n of project!.nodes) {
        if (n.x + 280 > maxX) { maxX = n.x + 280; maxY = n.y; }
      }
      const node: PromptNode = {
        id: uid(),
        type: blockData.type as PromptNode['type'],
        label: blockData.label,
        icon: blockData.icon,
        x: maxX,
        y: maxY,
        content: blockData.defaultContent,
        meta: {},
      };
      store.addNode(projectId, node);
      renderNodes();
    });
  });

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
      const blockData = JSON.parse(data);
      const connectionToSplit = findConnectionNearPoint(e.clientX, e.clientY);
      const worldPoint = screenToWorld(e.clientX, e.clientY);
      // Snap to 20px grid
      const rawX = worldPoint.x - 100;
      const rawY = worldPoint.y - 40;
      const node: PromptNode = {
        id: uid(),
        type: blockData.type,
        label: blockData.label,
        icon: blockData.icon,
        x: Math.round(rawX / 20) * 20,
        y: Math.round(rawY / 20) * 20,
        content: blockData.defaultContent,
        meta: {},
      };
      store.addNode(projectId, node);

      // If dropped on an existing connection, split it and insert the new node between.
      if (connectionToSplit) {
        store.removeConnection(projectId, connectionToSplit.id);
        store.addConnection(projectId, connectionToSplit.from, node.id);
        store.addConnection(projectId, node.id, connectionToSplit.to);
      }

      renderNodes();
    } catch { /* ignore bad data */ }
  });

  // ── Sidebar search ──
  const sidebarSearch = container.querySelector<HTMLInputElement>('#sidebar-search');
  sidebarSearch?.addEventListener('input', () => {
    const q = sidebarSearch.value.toLowerCase();
    container.querySelectorAll<HTMLElement>('.sidebar-block').forEach(block => {
      const label = block.dataset.label?.toLowerCase() ?? '';
      block.style.display = label.includes(q) ? '' : 'none';
    });
  });

  // ── Navigation ──
  container.querySelector('#nav-home')?.addEventListener('click', () => router.navigate('/'));
  container.querySelector('#crumb-home')?.addEventListener('click', () => router.navigate('/'));
  wireProjectViewTabs(container, projectId);

  // ── Export assembled prompt ──
  container.querySelector('#btn-export')?.addEventListener('click', () => {
    const assembled = store.assemblePrompt(projectId);
    navigator.clipboard.writeText(assembled).then(() => {
      const btn = container.querySelector('#btn-export')!;
      btn.innerHTML = '<span class="material-icons text-sm">check</span> Copied!';
      setTimeout(() => {
        btn.innerHTML = '<span class="material-icons text-sm">content_copy</span> Copy Assembled';
      }, 2000);
    });
  });

  // Theme toggle
  wireThemeToggle(container);
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
