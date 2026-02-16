/**
 * Dashboard View — Project card grid (matches page1.html mockup)
 */
import { store } from '../store';
import { router } from '../router';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { clearProjectEscapeToCanvas } from './project-nav';

type DashboardLayout = 'grid' | 'list';
const DASHBOARD_LAYOUT_KEY = 'promptblueprint_dashboard_layout';

export function renderDashboard(container: HTMLElement): void {
  clearProjectEscapeToCanvas(container);
  const projects = store.getProjects();

  container.innerHTML = `
    <!-- Top Navigation Bar -->
    <nav class="sticky top-0 z-50 bg-white/80 dark:bg-background-dark/80 backdrop-blur-md border-b border-card-border dark:border-primary/20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16 items-center">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 bg-primary rounded flex items-center justify-center">
              <span class="material-icons-outlined text-white text-xl">account_tree</span>
            </div>
            <span class="text-xl font-bold tracking-tight text-slate-800 dark:text-white">Prompt<span class="text-primary">Blueprint</span></span>
          </div>
          <div class="hidden md:flex flex-1 max-w-md mx-8">
            <div class="relative w-full">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span class="material-icons-outlined text-slate-400 text-sm">search</span>
              </div>
              <input id="search-input" class="block w-full pl-10 pr-3 py-2 border border-card-border dark:border-primary/20 rounded-lg bg-background-light dark:bg-background-dark/50 text-sm placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" placeholder="Search projects by name or model..." type="text" />
            </div>
          </div>
          <div class="flex items-center gap-4">
            ${themeToggleHTML()}
            <button class="p-2 text-slate-500 hover:text-primary transition-colors">
              <span class="material-icons-outlined">notifications</span>
            </button>
            <div class="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <span class="text-primary text-xs font-bold">JD</span>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <main class="flex-1 min-h-0 overflow-y-auto custom-scrollbar max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      <!-- Action Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-white leading-tight">Project Dashboard</h1>
          <p class="text-neutral-gray dark:text-neutral-gray/80 text-sm mt-1">Manage and orchestrate your node-based AI workflows.</p>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex bg-white dark:bg-slate-800 border border-card-border dark:border-primary/20 rounded-lg p-1">
            <button id="btn-grid-view" type="button" aria-label="Grid view" aria-pressed="true" class="p-1.5 rounded-md transition-colors bg-primary/10 text-primary">
              <span class="material-icons-outlined text-sm">grid_view</span>
            </button>
            <button id="btn-list-view" type="button" aria-label="List view" aria-pressed="false" class="p-1.5 rounded-md transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700">
              <span class="material-icons-outlined text-sm">view_list</span>
            </button>
          </div>
          <button id="btn-import-prompt" class="flex items-center gap-2 border border-primary/30 text-primary hover:bg-primary/5 px-4 py-2 rounded-lg font-medium transition-all">
            <span class="material-icons-outlined text-sm">file_upload</span>
            <span>Import Prompt</span>
          </button>
          <button id="btn-new-project" class="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-sm">
            <span class="material-icons-outlined text-sm">add</span>
            <span>New Project</span>
          </button>
        </div>
      </div>

      <!-- Project Card Grid -->
      <div id="project-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        ${projects.map(p => `
          <div class="project-card group bg-white dark:bg-slate-800/50 border border-card-border dark:border-primary/10 rounded-xl transition-all duration-200 cursor-pointer overflow-hidden flex flex-col" data-id="${p.id}">
            <div class="project-card-hero h-32 bg-slate-50 dark:bg-slate-900/50 relative overflow-hidden flex items-center justify-center border-b border-card-border dark:border-primary/5">
              <div class="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity" style="background-image: radial-gradient(#23956F 1.5px, transparent 1.5px); background-size: 12px 12px;"></div>
              <span class="material-icons-outlined text-slate-300 dark:text-slate-700 text-5xl">${p.icon}</span>
            </div>
            <div class="project-card-body p-5 flex-1 flex flex-col">
              <div class="flex justify-between items-start mb-2">
                <h3 class="font-semibold text-slate-800 dark:text-slate-100 group-hover:text-primary transition-colors">${p.name}</h3>
                <button class="delete-project text-slate-400 hover:text-red-500 dark:hover:text-red-400" data-id="${p.id}" title="Delete project">
                  <span class="material-icons-outlined text-lg">delete_outline</span>
                </button>
              </div>
              <p class="project-description text-sm text-neutral-gray dark:text-neutral-gray/80 line-clamp-2 mb-4">${p.description}</p>
              <div class="mt-auto">
                <div class="flex items-center gap-2 mb-3">
                  <span class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider rounded border border-primary/20">${p.model}</span>
                  <span class="text-[11px] text-slate-400 flex items-center gap-1">
                    <span class="material-icons-outlined text-[14px]">history</span>
                    ${p.lastEdited}
                  </span>
                </div>
              </div>
            </div>
          </div>
        `).join('')}

        <!-- New Project Card -->
        <div id="new-project-card" class="group border-2 border-dashed border-card-border dark:border-primary/20 rounded-xl transition-all duration-200 cursor-pointer hover:border-primary/50 hover:bg-primary/5 flex flex-col items-center justify-center min-h-[280px]">
          <div class="w-12 h-12 bg-slate-100 dark:bg-slate-800 group-hover:bg-primary group-hover:text-white rounded-full flex items-center justify-center text-slate-400 transition-colors mb-3">
            <span class="material-icons-outlined text-2xl">add_circle_outline</span>
          </div>
          <div class="new-project-card-copy flex flex-col items-center">
            <span class="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-primary">Create New Blueprint</span>
            <span class="text-[11px] text-slate-400 mt-1">Start from a blank canvas</span>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <footer class="mt-16 pt-8 border-t border-card-border dark:border-primary/10 flex flex-col md:flex-row justify-between items-center text-[12px] text-slate-400 gap-4">
        <div class="flex items-center gap-6">
          <a class="hover:text-primary transition-colors" href="#">Documentation</a>
          <a class="hover:text-primary transition-colors" href="#">Templates</a>
          <a class="hover:text-primary transition-colors" href="#">API Keys</a>
        </div>
        <p>&copy; 2026 PromptBlueprint. All rights reserved.</p>
      </footer>
    </main>

    <!-- New Project Modal -->
    <div id="new-project-modal" class="fixed inset-0 z-[999] hidden items-center justify-center bg-black/40 backdrop-blur-sm">
      <div class="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-card-border dark:border-primary/20 w-full max-w-md p-6">
        <h2 class="text-lg font-bold mb-4">New Project</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Project Name</label>
            <input id="modal-name" class="w-full border border-card-border dark:border-primary/20 rounded-lg px-3 py-2 text-sm bg-background-light dark:bg-background-dark focus:ring-1 focus:ring-primary outline-none" placeholder="My Voice Assistant" />
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Description</label>
            <textarea id="modal-desc" rows="2" class="w-full border border-card-border dark:border-primary/20 rounded-lg px-3 py-2 text-sm bg-background-light dark:bg-background-dark focus:ring-1 focus:ring-primary outline-none" placeholder="Describe the purpose of this prompt..."></textarea>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">Target Model</label>
            <select id="modal-model" class="w-full border border-card-border dark:border-primary/20 rounded-lg px-3 py-2 text-sm bg-background-light dark:bg-background-dark focus:ring-1 focus:ring-primary outline-none">
              <option>GPT-4o</option>
              <option>Claude 3.5</option>
              <option>GPT-4 Turbo</option>
              <option>Llama 3</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-3 mt-6">
          <button id="modal-cancel" class="px-4 py-2 text-sm font-medium border border-card-border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
          <button id="modal-create" class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">Create</button>
        </div>
      </div>
    </div>

    <!-- Decorative Element -->
    <div class="fixed bottom-0 right-0 p-8 opacity-20 pointer-events-none">
      <span class="material-icons-outlined text-9xl text-primary">scatter_plot</span>
    </div>
  `;

  // ── Event Wiring ──────────────────────
  // Click on project card → open canvas
  container.querySelectorAll<HTMLElement>('.project-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't navigate if clicking delete button
      if ((e.target as HTMLElement).closest('.delete-project')) return;
      const id = card.dataset.id;
      if (id) router.navigate(`/project/${id}`);
    });
  });

  // Delete project
  container.querySelectorAll<HTMLElement>('.delete-project').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id && confirm('Delete this project?')) {
        store.deleteProject(id);
        renderDashboard(container);
      }
    });
  });

  // New project modal
  const modal = container.querySelector<HTMLElement>('#new-project-modal')!;
  const openModal = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
  const closeModal = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };

  container.querySelector('#btn-import-prompt')?.addEventListener('click', () => router.navigate('/import'));
  container.querySelector('#btn-new-project')?.addEventListener('click', openModal);
  container.querySelector('#new-project-card')?.addEventListener('click', openModal);
  container.querySelector('#modal-cancel')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  container.querySelector('#modal-create')?.addEventListener('click', () => {
    const name = (container.querySelector('#modal-name') as HTMLInputElement).value.trim() || 'Untitled Blueprint';
    const desc = (container.querySelector('#modal-desc') as HTMLTextAreaElement).value.trim();
    const model = (container.querySelector('#modal-model') as HTMLSelectElement).value;
    const project = store.createProject(name, desc, model);
    closeModal();
    router.navigate(`/project/${project.id}`);
  });

  // Dashboard layout toggle (grid/list)
  const grid = container.querySelector<HTMLElement>('#project-grid');
  const gridBtn = container.querySelector<HTMLButtonElement>('#btn-grid-view');
  const listBtn = container.querySelector<HTMLButtonElement>('#btn-list-view');

  const setViewButtonState = (button: HTMLButtonElement, active: boolean): void => {
    button.classList.toggle('bg-primary/10', active);
    button.classList.toggle('text-primary', active);
    button.classList.toggle('text-slate-400', !active);
    button.classList.toggle('hover:text-slate-600', !active);
    button.classList.toggle('dark:hover:text-slate-200', !active);
    button.setAttribute('aria-pressed', String(active));
  };

  const applyLayout = (layout: DashboardLayout): void => {
    if (!grid || !gridBtn || !listBtn) return;
    const listView = layout === 'list';
    grid.classList.toggle('dashboard-list-view', listView);
    setViewButtonState(gridBtn, !listView);
    setViewButtonState(listBtn, listView);
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, layout);
  };

  if (grid && gridBtn && listBtn) {
    const savedLayout = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    const initialLayout: DashboardLayout = savedLayout === 'list' ? 'list' : 'grid';
    gridBtn.addEventListener('click', () => applyLayout('grid'));
    listBtn.addEventListener('click', () => applyLayout('list'));
    applyLayout(initialLayout);
  }

  // Search filter
  const searchInput = container.querySelector<HTMLInputElement>('#search-input');
  searchInput?.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    container.querySelectorAll<HTMLElement>('.project-card').forEach(card => {
      const text = card.textContent?.toLowerCase() ?? '';
      card.style.display = text.includes(q) ? '' : 'none';
    });
  });

  // Theme toggle
  wireThemeToggle(container);
}
