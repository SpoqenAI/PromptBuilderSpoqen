/**
 * Diff View — Version comparison with side-by-side diff (new feature)
 */
import { store } from '../store';
import { router } from '../router';
import { computeDiff, toSideBySideHTML, toUnifiedHTML } from '../diff';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { projectViewTabsHTML, wireEscapeToCanvas, wireProjectViewTabs } from './project-nav';

export function renderDiff(container: HTMLElement, projectId: string): void {
  const projectOrUndef = store.getProject(projectId);
  if (!projectOrUndef) { router.navigate('/'); return; }
  const project = projectOrUndef;

  const versions = store.getVersions(projectId);
  let leftIdx = versions.length >= 2 ? versions.length - 2 : 0;
  let rightIdx = versions.length >= 1 ? versions.length - 1 : 0;
  let unified = false;

  function render(): void {
    const hasVersions = versions.length >= 2;
    const oldText = hasVersions ? versions[leftIdx].content : '';
    const newText = hasVersions ? versions[rightIdx].content : (versions.length === 1 ? versions[0].content : '');

    const diff = hasVersions ? computeDiff(oldText, newText) : [];
    const sideBySide = hasVersions ? toSideBySideHTML(diff) : { leftHTML: '', rightHTML: '', stats: { added: 0, removed: 0, unchanged: 0 } };
    const unifiedHTML = hasVersions ? toUnifiedHTML(diff) : '';

    container.innerHTML = `
      <!-- Top Navigation Bar -->
      <header class="h-14 border-b border-primary/10 bg-white dark:bg-background-dark relative flex items-center px-4 z-30">
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white cursor-pointer" id="nav-home">
              <span class="material-icons text-sm">account_tree</span>
            </div>
            <div>
              <h1 class="text-sm font-semibold leading-none">${project.name}</h1>
              <span class="text-[10px] text-slate-400 uppercase tracking-wider">Version Diff</span>
            </div>
          </div>
        </div>
        <div class="absolute left-1/2 -translate-x-1/2">
          ${projectViewTabsHTML('diff')}
        </div>
        <div class="ml-auto flex items-center gap-3">
          ${themeToggleHTML()}
          <button id="btn-back" class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-primary/20 rounded text-primary hover:bg-primary/5 transition-colors">
            <span class="material-icons text-sm">arrow_back</span>
            Back to Canvas
          </button>
        </div>
      </header>

      <main class="flex-1 min-h-0 flex flex-col overflow-hidden">
        ${!hasVersions ? `
          <!-- No versions yet -->
          <div class="flex-1 flex flex-col items-center justify-center gap-4">
            <span class="material-icons text-6xl text-slate-300">difference</span>
            <h2 class="text-xl font-bold text-slate-600 dark:text-slate-300">No Versions to Compare</h2>
            <p class="text-sm text-slate-400 max-w-md text-center">Save at least two versions of your prompt from the editor to see diffs here. Each time you click "Save Version", a snapshot is recorded.</p>
            <button id="btn-go-canvas" class="mt-4 px-6 py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors">
              Go to Canvas
            </button>
          </div>
        ` : `
          <!-- Version Selector Bar -->
          <div class="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
                <label class="text-xs font-medium text-slate-500">Old:</label>
                <select id="select-left" class="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 focus:ring-1 focus:ring-primary outline-none">
                  ${versions.map((v, i) => `<option value="${i}" ${i === leftIdx ? 'selected' : ''}>${formatDate(v.timestamp)} — ${v.notes}</option>`).join('')}
                </select>
              </div>
              <span class="material-icons text-primary">compare_arrows</span>
              <div class="flex items-center gap-2">
                <label class="text-xs font-medium text-slate-500">New:</label>
                <select id="select-right" class="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 focus:ring-1 focus:ring-primary outline-none">
                  ${versions.map((v, i) => `<option value="${i}" ${i === rightIdx ? 'selected' : ''}>${formatDate(v.timestamp)} — ${v.notes}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="flex items-center gap-4">
              <!-- Stats -->
              <div class="flex items-center gap-3 text-xs font-mono">
                <span class="text-primary font-bold">+${sideBySide.stats.added} added</span>
                <span class="text-red-500 font-bold">-${sideBySide.stats.removed} removed</span>
                <span class="text-slate-400">${sideBySide.stats.unchanged} unchanged</span>
              </div>
              <!-- View toggle -->
              <div class="flex bg-slate-100 dark:bg-slate-800 p-1 rounded">
                <button class="view-btn px-3 py-1 text-xs font-medium rounded transition-colors ${!unified ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500'}" data-view="split">Split</button>
                <button class="view-btn px-3 py-1 text-xs font-medium rounded transition-colors ${unified ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500'}" data-view="unified">Unified</button>
              </div>
            </div>
          </div>

          <!-- Diff Content -->
          <div class="flex-1 overflow-auto custom-scrollbar bg-white dark:bg-slate-900">
            ${unified ? `
              <div class="p-4 font-mono text-xs">
                ${unifiedHTML}
              </div>
            ` : `
              <div class="flex h-full">
                <div class="flex-1 border-r border-slate-200 dark:border-slate-800 overflow-auto custom-scrollbar">
                  <div class="px-2 py-1 border-b border-slate-100 dark:border-slate-800 bg-red-50 dark:bg-red-900/10 text-xs font-medium text-slate-500 sticky top-0">
                    <span class="text-red-500 font-bold">OLD</span> — ${formatDate(versions[leftIdx].timestamp)}
                  </div>
                  <div class="p-2">${sideBySide.leftHTML}</div>
                </div>
                <div class="flex-1 overflow-auto custom-scrollbar">
                  <div class="px-2 py-1 border-b border-slate-100 dark:border-slate-800 bg-green-50 dark:bg-green-900/10 text-xs font-medium text-slate-500 sticky top-0">
                    <span class="text-primary font-bold">NEW</span> — ${formatDate(versions[rightIdx].timestamp)}
                  </div>
                  <div class="p-2">${sideBySide.rightHTML}</div>
                </div>
              </div>
            `}
          </div>
        `}
      </main>
    `;

    // ── Events ──
    container.querySelector('#nav-home')?.addEventListener('click', () => router.navigate('/'));
    wireProjectViewTabs(container, projectId);
    container.querySelector('#btn-back')?.addEventListener('click', () => router.navigate(`/project/${projectId}`));
    container.querySelector('#btn-go-canvas')?.addEventListener('click', () => router.navigate(`/project/${projectId}`));
    wireEscapeToCanvas(container, projectId);

    container.querySelector('#select-left')?.addEventListener('change', (e) => {
      leftIdx = parseInt((e.target as HTMLSelectElement).value);
      render();
    });
    container.querySelector('#select-right')?.addEventListener('change', (e) => {
      rightIdx = parseInt((e.target as HTMLSelectElement).value);
      render();
    });
    container.querySelectorAll<HTMLElement>('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        unified = btn.dataset.view === 'unified';
        render();
      });
    });

    // Theme toggle
    wireThemeToggle(container);
  }

  render();
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
