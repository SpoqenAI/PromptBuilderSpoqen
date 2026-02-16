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
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-primary rounded flex items-center justify-center cursor-pointer" id="nav-home">
            <span class="material-icons text-white text-xl">architecture</span>
          </div>
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

    <main class="flex-1 flex overflow-hidden h-[calc(100vh-3.5rem)]">
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
        <svg id="connection-svg" class="absolute inset-0 w-full h-full pointer-events-none z-[1]"></svg>

        <!-- Nodes container -->
        <div id="nodes-container" class="absolute inset-0 z-[2]">
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
        <div class="absolute bottom-6 left-6 w-32 h-24 bg-white/50 dark:bg-slate-900/50 border border-primary/10 rounded-lg overflow-hidden backdrop-blur-sm z-10">
          <div class="w-full h-full p-2 relative">
            <div class="absolute bottom-1 right-1 text-[8px] text-slate-400 uppercase font-bold">MiniMap</div>
          </div>
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
          <button class="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-primary transition-all">
            <span class="material-icons text-lg">help_outline</span>
          </button>
        </div>
      </aside>
    </main>
  `;

  // ── Render existing nodes ───────────
  const nodesContainer = container.querySelector<HTMLElement>('#nodes-container')!;
  const svgEl = container.querySelector<SVGSVGElement>('#connection-svg')!;

  // Track port-to-port connection drawing state
  let connectingFromNodeId: string | null = null;
  let tempLine: SVGLineElement | null = null;

  function renderNodes(): void {
    nodesContainer.querySelectorAll('.canvas-node').forEach(el => el.remove());
    const hint = nodesContainer.querySelector('#empty-hint');
    if (project!.nodes.length > 0 && hint) hint.remove();

    for (const node of project!.nodes) {
      const el = document.createElement('div');
      el.className = 'canvas-node bg-white dark:bg-slate-900 border border-primary/40 rounded-lg shadow-xl node-glow w-56';
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
          <div class="port-in port absolute -left-[7px] top-1/2 -translate-y-1/2 z-10" data-node-id="${node.id}" title="Drop a connection here"></div>
          <!-- Content preview -->
          <div class="p-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono leading-relaxed max-h-24 overflow-hidden">
            ${escapeHTML(node.content).substring(0, 120)}${node.content.length > 120 ? '…' : ''}
          </div>
          <!-- Output port (right side) -->
          <div class="port-out port absolute -right-[7px] top-1/2 -translate-y-1/2 z-10" data-node-id="${node.id}" title="Drag to connect"></div>
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
        node.x = origX + (e.clientX - startX);
        node.y = origY + (e.clientY - startY);
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        drawConnections();
      };
      const onMouseUp = () => {
        if (isDragging) {
          isDragging = false;
          el.classList.remove('dragging');
          // Snap to 20px grid
          node.x = Math.round(node.x / 20) * 20;
          node.y = Math.round(node.y / 20) * 20;
          el.style.left = `${node.x}px`;
          el.style.top = `${node.y}px`;
          store.updateNode(projectId, node.id, { x: node.x, y: node.y });
          drawConnections();
        }
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      // ── Port-based connection drawing ──
      const outPort = el.querySelector('.port-out') as HTMLElement;
      outPort.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        connectingFromNodeId = node.id;
        const canvasRect = nodesContainer.getBoundingClientRect();
        tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const portRect = outPort.getBoundingClientRect();
        const x1 = portRect.left + portRect.width / 2 - canvasRect.left;
        const y1 = portRect.top + portRect.height / 2 - canvasRect.top;
        tempLine.setAttribute('x1', String(x1));
        tempLine.setAttribute('y1', String(y1));
        tempLine.setAttribute('x2', String(x1));
        tempLine.setAttribute('y2', String(y1));
        tempLine.setAttribute('stroke', '#23956F');
        tempLine.setAttribute('stroke-width', '2');
        tempLine.setAttribute('stroke-dasharray', '6,3');
        tempLine.setAttribute('opacity', '0.6');
        svgEl.appendChild(tempLine);
        // Highlight all input ports as potential targets
        nodesContainer.querySelectorAll('.port-in').forEach(p => {
          if ((p as HTMLElement).dataset.nodeId !== node.id) {
            (p as HTMLElement).classList.add('ring-2', 'ring-primary', 'ring-offset-1');
            (p as HTMLElement).style.transform = 'translateY(-50%) scale(1.3)';
          }
        });
      });

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

  // ── Global mouse handlers for port connection ──
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!connectingFromNodeId || !tempLine) return;
    const canvasRect = nodesContainer.getBoundingClientRect();
    tempLine.setAttribute('x2', String(e.clientX - canvasRect.left));
    tempLine.setAttribute('y2', String(e.clientY - canvasRect.top));
  });

  document.addEventListener('mouseup', (e: MouseEvent) => {
    if (!connectingFromNodeId || !tempLine) return;
    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
    const portIn = target?.closest('.port-in') as HTMLElement | null;
    if (portIn) {
      const toNodeId = portIn.dataset.nodeId;
      if (toNodeId && toNodeId !== connectingFromNodeId) {
        const exists = project!.connections.some(c => c.from === connectingFromNodeId && c.to === toNodeId);
        if (!exists) {
          store.addConnection(projectId, connectingFromNodeId, toNodeId);
          drawConnections();
        }
      }
    }
    tempLine.remove();
    tempLine = null;
    connectingFromNodeId = null;
    nodesContainer.querySelectorAll('.port-in').forEach(p => {
      (p as HTMLElement).classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
      (p as HTMLElement).style.transform = 'translateY(-50%)';
    });
  });

  function drawConnections(): void {
    svgEl.innerHTML = '';
    const canvasRect = nodesContainer.getBoundingClientRect();

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
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
      path.setAttribute('stroke', '#23956F');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.classList.add('connector-path');
      path.style.cursor = 'pointer';
      path.style.pointerEvents = 'stroke';

      // Click connection to delete it
      path.addEventListener('click', () => {
        if (confirm(`Remove connection from "${fromEl.querySelector('h2')?.textContent?.trim()}" → "${toEl.querySelector('h2')?.textContent?.trim()}"?`)) {
          store.removeConnection(projectId, conn.id);
          drawConnections();
        }
      });
      svgEl.appendChild(path);

      // Dots at endpoints
      for (const [cx, cy] of [[x1, y1], [x2, y2]]) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', '#23956F');
        svgEl.appendChild(circle);
      }

      // Animated flow dot along the path
      const flowDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      flowDot.setAttribute('r', '3');
      flowDot.setAttribute('fill', '#23956F');
      flowDot.setAttribute('opacity', '0.7');
      const animateMotion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
      animateMotion.setAttribute('dur', '3s');
      animateMotion.setAttribute('repeatCount', 'indefinite');
      animateMotion.setAttribute('path', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
      flowDot.appendChild(animateMotion);
      svgEl.appendChild(flowDot);
    }
  }

  renderNodes();

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

      // Auto-connect to last node if exists
      const nodes = project!.nodes;
      if (nodes.length > 1) {
        const prevNode = nodes[nodes.length - 2];
        store.addConnection(projectId, prevNode.id, node.id);
      }
      renderNodes();
    });
  });

  const canvasArea = container.querySelector<HTMLElement>('#canvas-area')!;
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
      const rect = canvasArea.getBoundingClientRect();
      // Snap to 20px grid
      const rawX = e.clientX - rect.left - 100;
      const rawY = e.clientY - rect.top - 40;
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

      // Auto-connect to last node if exists
      const nodes = project!.nodes;
      if (nodes.length > 1) {
        const prevNode = nodes[nodes.length - 2];
        store.addConnection(projectId, prevNode.id, node.id);
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
