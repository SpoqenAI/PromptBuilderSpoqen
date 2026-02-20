/**
 * main.ts - Application entry point.
 * Sets up the SPA router and renders the appropriate view.
 */
import './styles.css';
import { router } from './router';
import { renderDashboard } from './views/dashboard';
import { renderCanvas } from './views/canvas';
import { renderEditor } from './views/editor';
import { renderDiff } from './views/diff';
import { renderImport } from './views/import';
import { renderTranscriptImport } from './views/transcript-import';
import { renderAuthPage, renderOnboardingPage } from './views/auth';
import { applyTheme } from './theme';
import { store, type StoreRemoteErrorEventDetail } from './store';
import { getCurrentUser, isOnboardingComplete } from './auth';

applyTheme();

const app = document.getElementById('app')!;
app.className = 'flex flex-col h-screen overflow-hidden';

function upsertPersistenceBanner(detail: StoreRemoteErrorEventDetail | null = null): void {
  const status = detail ?? { context: 'status', ...store.getPersistenceStatus() };
  const existing = document.getElementById('persistence-banner');

  if (status.mode === 'database') {
    existing?.remove();
    return;
  }

  const banner = existing ?? document.createElement('div');
  banner.id = 'persistence-banner';
  banner.className =
    'fixed bottom-4 right-4 z-[1001] max-w-md rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100';

  const hint = status.hint ?? 'Database writes are blocked. Data is currently only in localStorage.';
  const title = document.createElement('p');
  const hintLine = document.createElement('p');
  const errorLine = document.createElement('p');
  title.className = 'font-semibold';
  hintLine.className = 'mt-1';
  errorLine.className = 'mt-1 opacity-80';
  title.textContent = 'Database sync unavailable';
  hintLine.textContent = hint;
  errorLine.textContent = `Latest error: ${status.error ?? 'unknown'}`;
  banner.replaceChildren(title, hintLine, errorLine);

  if (!existing) {
    document.body.appendChild(banner);
  }
}

window.addEventListener('store:remote-error', (event: Event) => {
  const customEvent = event as CustomEvent<StoreRemoteErrorEventDetail>;
  upsertPersistenceBanner(customEvent.detail);
});

function showLoading(message: string): void {
  app.innerHTML = `
    <div class="flex-1 flex flex-col items-center justify-center gap-4">
      <div class="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
      <p class="text-sm text-slate-500 font-medium">${message}</p>
    </div>
  `;
}

async function runPublicAuthRoute(mode: 'sign-in' | 'sign-up'): Promise<void> {
  showLoading('Checking session...');
  try {
    const user = await getCurrentUser();
    if (!user) {
      renderAuthPage(app, mode);
      return;
    }

    const onboardingDone = await isOnboardingComplete(user.id);
    router.navigate(onboardingDone ? '/' : '/auth/onboarding');
  } catch (err) {
    console.error('Auth route error:', err);
    renderAuthPage(app, mode);
  }
}

async function runOnboardingRoute(): Promise<void> {
  showLoading('Loading onboarding...');
  try {
    const user = await getCurrentUser();
    if (!user) {
      router.navigate('/auth/sign-in');
      return;
    }

    await renderOnboardingPage(app, user);
  } catch (err) {
    console.error('Onboarding route error:', err);
    router.navigate('/auth/sign-in');
  }
}

async function runProtectedRoute(render: () => void): Promise<void> {
  showLoading('Loading your workspace...');
  try {
    const user = await getCurrentUser();
    if (!user) {
      router.navigate('/auth/sign-in');
      return;
    }

    const onboardingDone = await isOnboardingComplete(user.id);
    if (!onboardingDone) {
      router.navigate('/auth/onboarding');
      return;
    }

    await store.ready;
    upsertPersistenceBanner();
    render();
  } catch (err) {
    console.error('Protected route error:', err);
    router.navigate('/auth/sign-in');
  }
}

showLoading('Starting app...');

router
  .on('/auth/sign-in', () => {
    void runPublicAuthRoute('sign-in');
  })
  .on('/auth/sign-up', () => {
    void runPublicAuthRoute('sign-up');
  })
  .on('/auth/onboarding', () => {
    void runOnboardingRoute();
  })
  .on('/', () => {
    void runProtectedRoute(() => renderDashboard(app));
  })
  .on('/project/:id', (params) => {
    void runProtectedRoute(() => renderCanvas(app, params.id));
  })
  .on('/project/:id/editor/:nodeId', (params) => {
    void runProtectedRoute(() => renderEditor(app, params.id, params.nodeId));
  })
  .on('/project/:id/diff', (params) => {
    void runProtectedRoute(() => renderDiff(app, params.id));
  })
  .on('/import', () => {
    void runProtectedRoute(() => renderImport(app));
  })
  .on('/import/transcript', () => {
    void runProtectedRoute(() => renderTranscriptImport(app));
  })
  .otherwise(() => {
    router.navigate('/');
  })
  .start();
