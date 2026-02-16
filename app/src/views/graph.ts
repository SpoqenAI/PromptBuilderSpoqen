/**
 * Graph View — 3-tier orchestration graph visualization (matches page4.html mockup)
 */
import { store } from '../store';
import { router } from '../router';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { projectViewTabsHTML, wireEscapeToCanvas, wireProjectViewTabs } from './project-nav';

export function renderGraph(container: HTMLElement, projectId: string): void {
  const project = store.getProject(projectId);
  if (!project) { router.navigate('/'); return; }

  container.innerHTML = `
    <!-- Global Toolbar -->
    <header class="h-14 border-b border-primary/20 bg-background-light dark:bg-background-dark/80 backdrop-blur-md relative flex items-center px-4 z-50">
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-2">
          <button type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer rounded" id="nav-home" aria-label="Go to dashboard">
            <img src="/Icon.svg" alt="Spoqen" class="w-8 h-8 object-contain" />
          </button>
          <div>
            <h1 class="text-sm font-semibold leading-none">${project.name}</h1>
            <span class="text-[10px] text-slate-400 uppercase tracking-wider">Graph Overview</span>
          </div>
        </div>
      </div>
      <div class="absolute left-1/2 -translate-x-1/2">
        ${projectViewTabsHTML('graph')}
      </div>
      <div class="ml-auto flex items-center gap-3">
        <div class="flex items-center bg-primary/5 border border-primary/20 rounded-lg p-1 mr-4">
          <button class="p-1.5 hover:bg-primary/20 rounded transition-colors" id="btn-zoom-out-graph"><span class="material-icons text-sm">zoom_out</span></button>
          <span class="px-3 text-xs font-mono" id="zoom-level">100%</span>
          <button class="p-1.5 hover:bg-primary/20 rounded transition-colors" id="btn-zoom-in-graph"><span class="material-icons text-sm">zoom_in</span></button>
        </div>
        <button id="btn-copy" class="flex items-center gap-2 px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded-lg text-sm font-semibold transition-all">
          <span class="material-icons text-sm">content_copy</span>
          Export
        </button>
        ${themeToggleHTML()}
      </div>
    </header>

    <main class="flex-1 min-h-0 flex overflow-hidden">
      <!-- Graph Canvas -->
      <section id="graph-canvas" class="flex-1 relative blueprint-grid overflow-auto">
        <!-- Connection Lines SVG -->
        <svg id="graph-svg" class="absolute inset-0 w-full h-full pointer-events-none" style="min-width: 1200px; min-height: 800px;"></svg>

        <!-- Nodes get rendered here -->
        <div id="graph-nodes" class="relative" style="min-width: 1200px; min-height: 800px;"></div>

        <!-- Mini Map -->
        <div class="fixed bottom-6 left-6 w-32 h-24 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border border-primary/20 rounded-lg overflow-hidden flex items-center justify-center z-10">
          <div class="relative w-full h-full opacity-30" id="minimap-dots"></div>
          <div class="absolute inset-0 border-2 border-primary/30 m-2 rounded-sm"></div>
        </div>
      </section>

      <!-- Properties Inspector -->
      <aside class="w-80 border-l border-primary/10 bg-background-light dark:bg-background-dark/50 flex flex-col shrink-0">
        <div class="p-4 border-b border-primary/10">
          <h3 class="text-sm font-bold flex items-center gap-2">
            <span class="material-icons text-primary text-base">info</span>
            Graph Overview
          </h3>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
          <!-- Graph stats -->
          <div class="space-y-3">
            <label class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Summary</label>
            <div class="space-y-4">
              <div class="space-y-1">
                <span class="text-[11px] text-slate-400">Total Nodes</span>
                <div class="text-xl font-mono font-bold text-primary">${project.nodes.length}</div>
              </div>
              <div class="space-y-1">
                <span class="text-[11px] text-slate-400">Connections</span>
                <div class="text-xl font-mono font-bold text-primary">${project.connections.length}</div>
              </div>
              <div class="space-y-1">
                <span class="text-[11px] text-slate-400">Versions Saved</span>
                <div class="text-xl font-mono font-bold text-primary">${project.versions.length}</div>
              </div>
            </div>
          </div>

          <div class="h-px bg-primary/10"></div>

          <!-- Execution order -->
          <div class="space-y-3">
            <label class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Execution Order</label>
            <div class="space-y-2">
              ${project.nodes.map((n, i) => `
                <div class="flex items-center gap-3 p-2 bg-white dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                  <span class="w-6 h-6 bg-primary/10 text-primary text-[10px] font-bold rounded flex items-center justify-center">${i + 1}</span>
                  <div class="flex-1">
                    <span class="text-xs font-medium">${n.label}</span>
                    <span class="text-[10px] text-slate-400 ml-2">${n.type}</span>
                  </div>
                </div>
              `).join('')}
              ${project.nodes.length === 0 ? '<p class="text-xs text-slate-400 italic">No nodes yet. Add blocks from the canvas view.</p>' : ''}
            </div>
          </div>

          <!-- Runtime Tags -->
          <div class="space-y-3">
            <label class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Runtime Tags</label>
            <div class="flex flex-wrap gap-2">
              <span class="px-2 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded">STREAMING</span>
              <span class="px-2 py-1 bg-slate-200 dark:bg-slate-800 text-slate-400 text-[10px] font-bold rounded">LOGITS</span>
              <span class="px-2 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded">JSON_MODE</span>
            </div>
          </div>
        </div>
        <div class="p-4 border-t border-primary/10 grid grid-cols-2 gap-2">
          <button id="btn-back-canvas" class="py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">CANVAS</button>
          <button id="btn-copy-assembled" class="py-2 text-xs font-bold bg-primary text-white rounded-lg shadow-md shadow-primary/20">COPY ALL</button>
        </div>
      </aside>
    </main>

    <!-- Footer -->
    <footer class="h-8 bg-slate-100 dark:bg-slate-900 border-t border-primary/10 flex items-center justify-between px-4 shrink-0">
      <div class="flex items-center gap-6">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-primary shadow-[0_0_4px_#23956F]"></div>
          <span class="text-[10px] font-bold text-slate-500 uppercase">SYSTEM READY</span>
        </div>
      </div>
      <div class="text-[10px] font-mono text-slate-500">
        Graph: ${project.name} &bull; ${project.nodes.length} Nodes &bull; ${project.connections.length} Connections
      </div>
    </footer>
  `;

  // ── Render graph nodes ──
  const graphNodes = container.querySelector<HTMLElement>('#graph-nodes')!;
  const graphSvg = container.querySelector<SVGSVGElement>('#graph-svg')!;

  // Layout: auto-position nodes in a horizontal flow if they don't have good positions
  const layoutNodes = [...project.nodes];
  const COLS = 3;
  const NODE_W = 240, NODE_H = 180, GAP_X = 120, GAP_Y = 80, PAD = 60;

  layoutNodes.forEach((node, i) => {
    // If positions are clustered at 0,0 we re-layout
    if (node.x < 10 && node.y < 10 && i > 0) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      node.x = PAD + col * (NODE_W + GAP_X);
      node.y = PAD + row * (NODE_H + GAP_Y);
      store.updateNode(projectId, node.id, { x: node.x, y: node.y });
    }
  });

  for (const node of layoutNodes) {
    const el = document.createElement('div');
    el.className = 'absolute bg-white dark:bg-slate-900 border border-primary/40 rounded shadow-xl node-glow';
    el.style.cssText = `left: ${node.x}px; top: ${node.y}px; width: ${NODE_W}px;`;
    el.dataset.nodeId = node.id;
    el.innerHTML = `
      <div class="bg-primary/10 border-b border-primary/20 p-3 flex items-center justify-between">
        <h2 class="text-sm font-bold flex items-center gap-2">
          <span class="material-icons text-sm text-primary">${node.icon}</span>
          ${node.label}
        </h2>
        <span class="material-icons text-xs text-primary cursor-pointer graph-node-click" data-node-id="${node.id}">open_in_new</span>
      </div>
      <div class="p-4 text-[11px] font-mono text-slate-500 leading-relaxed max-h-24 overflow-hidden">
        ${escapeHTML(node.content).substring(0, 100)}${node.content.length > 100 ? '…' : ''}
      </div>
      <div class="bg-slate-50 dark:bg-slate-800/50 p-2 flex justify-between">
        <div class="w-3 h-3 bg-primary rounded-full" title="Input port"></div>
        <span class="text-[9px] text-slate-400 uppercase">${node.type}</span>
        <div class="w-3 h-3 bg-primary rounded-full shadow-[0_0_8px_#23956F]" title="Output port"></div>
      </div>
    `;
    graphNodes.appendChild(el);
  }

  // Draw connections
  function drawGraphConnections(): void {
    graphSvg.innerHTML = '';
    for (const conn of project!.connections) {
      const fromEl = graphNodes.querySelector<HTMLElement>(`[data-node-id="${conn.from}"]`);
      const toEl = graphNodes.querySelector<HTMLElement>(`[data-node-id="${conn.to}"]`);
      if (!fromEl || !toEl) continue;

      const x1 = fromEl.offsetLeft + NODE_W;
      const y1 = fromEl.offsetTop + NODE_H / 2;
      const x2 = toEl.offsetLeft;
      const y2 = toEl.offsetTop + NODE_H / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`);
      path.setAttribute('stroke', '#23956F');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-dasharray', '5,5');
      path.classList.add('connector-path');
      graphSvg.appendChild(path);

      for (const [cx, cy] of [[x1, y1], [x2, y2]]) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', '4');
        circle.setAttribute('fill', '#23956F');
        graphSvg.appendChild(circle);
      }
    }
  }

  drawGraphConnections();

  // ── Minimap dots ──
  const minimapDots = container.querySelector<HTMLElement>('#minimap-dots')!;
  for (const node of layoutNodes) {
    const dot = document.createElement('div');
    const scale = 0.08;
    dot.className = 'absolute bg-primary/40 rounded-sm';
    dot.style.cssText = `left: ${node.x * scale + 10}px; top: ${node.y * scale + 5}px; width: ${NODE_W * scale}px; height: ${(NODE_H * 0.6) * scale}px;`;
    minimapDots.appendChild(dot);
  }

  // ── Click node → open editor ──
  container.querySelectorAll<HTMLElement>('.graph-node-click').forEach(btn => {
    btn.addEventListener('click', () => {
      const nId = btn.dataset.nodeId;
      if (nId) router.navigate(`/project/${projectId}/editor/${nId}`);
    });
  });

  // ── Zoom ──
  let zoom = 100;
  const zoomLabel = container.querySelector<HTMLElement>('#zoom-level')!;
  const graphCanvas = container.querySelector<HTMLElement>('#graph-canvas')!;
  container.querySelector('#btn-zoom-in-graph')?.addEventListener('click', () => {
    zoom = Math.min(200, zoom + 10);
    zoomLabel.textContent = `${zoom}%`;
    graphNodes.style.transform = `scale(${zoom / 100})`;
    graphNodes.style.transformOrigin = 'top left';
    graphSvg.style.transform = `scale(${zoom / 100})`;
    graphSvg.style.transformOrigin = 'top left';
  });
  container.querySelector('#btn-zoom-out-graph')?.addEventListener('click', () => {
    zoom = Math.max(30, zoom - 10);
    zoomLabel.textContent = `${zoom}%`;
    graphNodes.style.transform = `scale(${zoom / 100})`;
    graphNodes.style.transformOrigin = 'top left';
    graphSvg.style.transform = `scale(${zoom / 100})`;
    graphSvg.style.transformOrigin = 'top left';
  });

  // ── Navigation ──
  container.querySelector('#nav-home')?.addEventListener('click', () => router.navigate('/'));
  wireProjectViewTabs(container, projectId);
  container.querySelector('#btn-back-canvas')?.addEventListener('click', () => router.navigate(`/project/${projectId}`));
  wireEscapeToCanvas(container, projectId);

  // ── Copy ──
  container.querySelector('#btn-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(store.assemblePrompt(projectId));
  });
  container.querySelector('#btn-copy-assembled')?.addEventListener('click', () => {
    navigator.clipboard.writeText(store.assemblePrompt(projectId));
  });

  // Theme toggle
  wireThemeToggle(container);
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
