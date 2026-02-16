/**
 * main.ts — Application entry point.
 * Sets up the SPA router and renders the appropriate view.
 */
import './styles.css';
import { router } from './router';
import { renderDashboard } from './views/dashboard';
import { renderCanvas } from './views/canvas';
import { renderEditor } from './views/editor';
import { renderGraph } from './views/graph';
import { renderDiff } from './views/diff';
import { renderImport } from './views/import';
import { applyTheme } from './theme';
import { store } from './store';

// Apply saved theme immediately
applyTheme();

const app = document.getElementById('app')!;
app.className = 'flex flex-col h-screen overflow-hidden';

// Show loading indicator while Supabase data loads
app.innerHTML = `
  <div class="flex-1 flex flex-col items-center justify-center gap-4">
    <div class="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
    <p class="text-sm text-slate-500 font-medium">Loading from database…</p>
  </div>
`;

// Wait for Supabase data, then start the router
store.ready.then(() => {
  router
    .on('/', () => {
      renderDashboard(app);
    })
    .on('/project/:id', (params) => {
      renderCanvas(app, params.id);
    })
    .on('/project/:id/editor/:nodeId', (params) => {
      renderEditor(app, params.id, params.nodeId);
    })
    .on('/project/:id/graph', (params) => {
      renderGraph(app, params.id);
    })
    .on('/project/:id/diff', (params) => {
      renderDiff(app, params.id);
    })
    .on('/import', () => {
      renderImport(app);
    })
    .otherwise(() => {
      renderDashboard(app);
    })
    .start();
});
