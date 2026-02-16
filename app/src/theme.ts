/**
 * Theme — Manages light/dark mode toggle, persists to localStorage.
 */

const STORAGE_KEY = 'pb-theme';

export type Theme = 'light' | 'dark';

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  // Check system preference
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function toggleTheme(): void {
  const current = getTheme();
  setTheme(current === 'dark' ? 'light' : 'dark');
}

export function applyTheme(theme?: Theme): void {
  const t = theme ?? getTheme();
  const html = document.documentElement;
  if (t === 'dark') {
    html.classList.remove('light');
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
    html.classList.add('light');
  }
}

/** Returns theme toggle button HTML (to embed in nav bars). */
export function themeToggleHTML(): string {
  const isDark = getTheme() === 'dark';
  return `
    <button id="theme-toggle" class="theme-toggle" title="Toggle dark/light mode" aria-label="Toggle theme">
      <span class="sr-only">${isDark ? 'Switch to light mode' : 'Switch to dark mode'}</span>
    </button>
    <span class="material-icons text-sm text-slate-400 ml-1" style="pointer-events:none">${isDark ? 'dark_mode' : 'light_mode'}</span>
  `;
}

/** Wire up the toggle button event after inserting HTML. */
export function wireThemeToggle(container: HTMLElement): void {
  container.querySelector('#theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    // Re-render the current route by triggering hashchange
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
