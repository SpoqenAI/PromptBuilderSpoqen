import { router } from '../router';

export type ProjectView = 'canvas' | 'editor' | 'diff';

type ProjectSubView = 'canvas' | 'diff';

interface ProjectNavContainer extends HTMLElement {
  __pbEscCleanup?: () => void;
}

const SUB_VIEWS: Array<{ view: ProjectSubView; label: string; icon: string }> = [
  { view: 'canvas', label: 'Canvas', icon: 'dashboard' },
  { view: 'diff', label: 'Diff', icon: 'difference' },
];

function pathForView(projectId: string, view: ProjectSubView): string {
  if (view === 'canvas') return `/project/${projectId}`;
  return `/project/${projectId}/diff`;
}

function buttonClasses(isActive: boolean): string {
  if (isActive) {
    return 'px-2.5 py-1.5 rounded-md bg-white dark:bg-slate-700 text-primary text-xs font-semibold shadow-sm';
  }
  return 'px-2.5 py-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:text-primary hover:bg-white/70 dark:hover:bg-slate-700/70 text-xs font-semibold transition-colors';
}

export function projectViewTabsHTML(activeView: ProjectView): string {
  const activeSubView: ProjectSubView = activeView === 'diff' ? 'diff' : 'canvas';

  return `
    <div class="project-view-tabs flex items-center gap-2">
      <div class="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
        ${SUB_VIEWS.map(({ view, label, icon }) => `
          <button
            type="button"
            data-project-view="${view}"
            class="${buttonClasses(activeSubView === view)}"
            aria-current="${activeSubView === view ? 'page' : 'false'}"
          >
            <span class="material-icons text-[14px] align-middle mr-1">${icon}</span>${label}
          </button>
        `).join('')}
      </div>
      ${activeView === 'editor' ? '<span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Editing Node</span>' : ''}
    </div>
  `;
}

export function wireProjectViewTabs(
  container: HTMLElement,
  projectId: string,
  options?: { beforeNavigate?: () => void },
): void {
  container.querySelectorAll<HTMLButtonElement>('[data-project-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.projectView as ProjectSubView | undefined;
      if (!view) return;
      options?.beforeNavigate?.();
      router.navigate(pathForView(projectId, view));
    });
  });
}

export function clearProjectEscapeToCanvas(container: HTMLElement): void {
  const host = container as ProjectNavContainer;
  if (host.__pbEscCleanup) {
    host.__pbEscCleanup();
    delete host.__pbEscCleanup;
  }
}

export function wireEscapeToCanvas(
  container: HTMLElement,
  projectId: string,
  options?: { onEscape?: () => void; skipWhenOpen?: string },
): void {
  clearProjectEscapeToCanvas(container);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;

    if (options?.skipWhenOpen && container.querySelector(options.skipWhenOpen)) {
      return;
    }

    event.preventDefault();
    options?.onEscape?.();
    router.navigate(`/project/${projectId}`);
  };

  document.addEventListener('keydown', onKeyDown);

  (container as ProjectNavContainer).__pbEscCleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}
