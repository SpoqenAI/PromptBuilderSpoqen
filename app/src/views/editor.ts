/**
 * Editor View - Prompt editor modal with tokenizer visualization.
 */
import { store } from '../store';
import { router } from '../router';
import { countTokens, toHighlightedHTML } from '../tokenizer';
import type { EditorFormat } from '../models';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { preserveScrollDuringRender } from '../view-state';
import { projectViewTabsHTML, wireEscapeToCanvas, wireProjectViewTabs } from './project-nav';
import { customPrompt } from '../dialogs';
import {
  buildNodeColorStyles,
  DEFAULT_NODE_COLOR,
  getAutoNodeColor,
  NODE_AUTO_COLORS,
  normalizeNodeColor,
  readNodeColorMeta,
  withNodeColorMeta,
} from '../node-colors';

const NODE_ICON_SUGGESTIONS = [
  'psychology',
  'flag',
  'record_voice_over',
  'translate',
  'alt_route',
  'call_end',
  'storage',
  'article',
  'history',
  'integration_instructions',
  'mic',
  'widgets',
  'hub',
  'schema',
  'bolt',
  'smart_toy',
  'terminal',
  'code',
  'memory',
  'science',
  'auto_awesome',
  'construction',
  'cloud',
  'dns',
  'extension',
  'flare',
  'functions',
  'grid_view',
  'insights',
  'key',
  'lightbulb',
  'link',
  'model_training',
  'network_check',
  'offline_bolt',
  'pending',
  'policy',
  'query_stats',
  'robot',
  'settings',
  'speed',
  'star',
  'sync',
  'timeline',
  'track_changes',
  'transform',
  'tune',
  'visibility',
  'warning',
  'wifi',
  'work',
];

// Create icon options for the dropdown
const ICON_OPTIONS = NODE_ICON_SUGGESTIONS.map(icon => ({ value: icon, label: icon }));

export function renderEditor(container: HTMLElement, projectId: string, nodeId: string): void {
  const projectOrUndef = store.getProject(projectId);
  if (!projectOrUndef) { router.navigate('/'); return; }
  const project = projectOrUndef;
  const nodeOrUndef = project.nodes.find((n) => n.id === nodeId);
  if (!nodeOrUndef) { router.navigate(`/project/${projectId}`); return; }
  const node = nodeOrUndef;

  const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n');
  const normalizeIconName = (value: string): string =>
    value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

  let tokenizerActive = true;
  let editorFormat: EditorFormat = 'markdown';
  let currentContent = normalizeLineEndings(node.content);
  let currentIcon = normalizeIconName(node.icon) || 'widgets';
  let currentNodeColor = readNodeColorMeta(node.meta) ?? DEFAULT_NODE_COLOR;

  const persistDraft = (): void => {
    const labelInput = container.querySelector<HTMLInputElement>('#prop-label');
    const iconInput = container.querySelector<HTMLSelectElement>('#prop-icon');
    const colorInput = container.querySelector<HTMLInputElement>('#prop-node-color');
    const nextLabel = labelInput?.value.trim() || node.label;
    const nextIcon = normalizeIconName(iconInput?.value ?? currentIcon) || 'widgets';
    const nextColor = normalizeNodeColor(colorInput?.value ?? currentNodeColor) ?? DEFAULT_NODE_COLOR;
    const nextMeta = withNodeColorMeta(node.meta, nextColor);
    store.updateNode(projectId, nodeId, {
      content: currentContent,
      label: nextLabel,
      icon: nextIcon,
      meta: nextMeta,
    });
    node.content = currentContent;
    node.label = nextLabel;
    node.icon = nextIcon;
    node.meta = nextMeta;
    currentIcon = nextIcon;
    currentNodeColor = nextColor;
    if (iconInput) {
      iconInput.value = nextIcon;
    }
    if (colorInput) {
      colorInput.value = nextColor;
    }
  };

  const closeToCanvas = (): void => {
    persistDraft();
    router.navigate(`/project/${projectId}`);
  };

  function render(): void {
    const tokenCount = countTokens(currentContent);
    const previewColor = normalizeNodeColor(currentNodeColor) ?? DEFAULT_NODE_COLOR;
    const previewStyles = buildNodeColorStyles(previewColor);
    const colorPalette = [previewColor, ...NODE_AUTO_COLORS.filter((value) => value !== previewColor)];

    preserveScrollDuringRender(container, () => {
      container.innerHTML = `
      <div id="editor-overlay" class="fixed inset-0 z-[900] bg-slate-950/35 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
        <div id="editor-modal" class="w-full max-w-[1800px] h-[min(95dvh,1100px)] min-h-[26rem] bg-white dark:bg-background-dark rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
          <!-- Top Navigation Bar -->
          <header class="ui-header z-30">
            <div class="ui-header-left">
              <button id="btn-back-canvas" class="ui-btn ui-btn-outline">
                <span class="material-icons text-sm">arrow_back</span>
                Canvas
              </button>
              <div class="flex items-center gap-3 min-w-0">
                <button type="button" class="h-10 w-[min(14rem,42vw)] flex items-center justify-start cursor-pointer rounded shrink-0" id="nav-home" aria-label="Go to dashboard">
                  <img src="/Spoqen(2).svg" alt="Spoqen" class="h-full w-full object-contain object-left" />
                </button>
                <div class="min-w-0">
                  <h1 class="text-sm font-semibold leading-none truncate max-w-[26ch]">${project.name}</h1>
                  <span class="text-[10px] text-slate-400 uppercase tracking-wider truncate block max-w-[26ch]">${node.label}</span>
                </div>
              </div>
            </div>
            <div class="ui-header-center">
              ${projectViewTabsHTML('editor')}
            </div>
            <div class="ui-header-right ui-toolbar">
              ${themeToggleHTML()}
              <button id="btn-save-version" class="ui-btn ui-btn-outline">
                <span class="material-icons text-sm">save</span>
                Save Current State
              </button>
              <button id="btn-save-custom-node" class="ui-btn ui-btn-outline">
                <span class="material-icons text-sm">bookmark_add</span>
                Save Custom Node
              </button>
              <button id="btn-export-runtime" class="ui-btn ui-btn-primary">
                <span class="material-icons text-sm">content_copy</span>
                Copy Runtime
              </button>
              <button id="btn-export-flow" class="ui-btn ui-btn-outline">
                <span class="material-icons text-sm">account_tree</span>
                Copy Flow
              </button>
              <button id="btn-close-editor" class="ui-btn ui-btn-ghost !p-2" aria-label="Close editor">
                <span class="material-icons text-sm">close</span>
              </button>
            </div>
          </header>

          <!-- Main Workspace -->
          <main class="ui-main ui-stack-lg">
            <!-- Editor Area -->
            <div class="ui-pane flex-1 relative bg-slate-50 dark:bg-slate-900/50 p-4 sm:p-6 lg:p-8 overflow-auto custom-scrollbar" data-scroll-preserve="editor-main">
              <div class="max-w-4xl mx-auto bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col min-h-full">
                <!-- Node Header -->
                <div class="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-10">
                  <div class="flex items-center gap-3">
                    <div class="p-2 rounded-lg" style="background:${previewStyles.headerBackground}; color:${previewStyles.icon}; border:1px solid ${previewStyles.headerBorder};">
                      <span id="node-icon-preview" class="material-icons">${currentIcon}</span>
                    </div>
                    <div>
                      <h2 class="font-semibold text-slate-800 dark:text-slate-100">${node.label}</h2>
                    </div>
                  </div>
                  <div class="flex items-center gap-4">
                    <!-- Tokenizer Toggle -->
                    <button id="btn-toggle-tokenizer" class="flex items-center gap-2 px-3 py-1 rounded-full transition-colors ${tokenizerActive ? 'bg-primary/10 text-primary' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}">
                      <span class="material-icons text-sm">donut_large</span>
                      <span class="text-xs font-bold uppercase tracking-wider">${tokenizerActive ? 'Tokenizer Active' : 'Tokenizer Off'}</span>
                    </button>
                    <!-- Language Toggle -->
                    <div class="flex bg-slate-100 dark:bg-slate-800 p-1 rounded">
                      <button class="format-btn px-3 py-1 text-xs font-medium rounded transition-colors ${editorFormat === 'markdown' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}" data-format="markdown">Markdown</button>
                      <button class="format-btn px-3 py-1 text-xs font-medium rounded transition-colors ${editorFormat === 'xml' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}" data-format="xml">XML</button>
                    </div>
                  </div>
                </div>

                <!-- Content Area with Tokenizer Highlights -->
                <div class="flex-1 editor-overlay min-h-[18rem]">
                  <div class="highlight-layer" id="highlight-layer">${toHighlightedHTML(currentContent, tokenizerActive)}</div>
                  <textarea id="editor-textarea" spellcheck="false"></textarea>
                </div>

                <!-- Footer Stats -->
                <div class="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-xs text-slate-500 font-medium">
                  <div class="flex gap-4">
                    <span class="flex items-center gap-1"><span class="material-icons text-[14px]">short_text</span> <span id="token-count">${tokenCount}</span> Tokens</span>
                    <span class="flex items-center gap-1"><span class="material-icons text-[14px]">history</span> Editing now</span>
                  </div>
                  <div class="flex items-center gap-1 text-primary">
                    <span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                    Live Preview Sync
                  </div>
                </div>
              </div>
            </div>

            <!-- Properties Panel -->
            <aside class="ui-sidebar ui-sidebar-wide border-l border-primary/10 bg-white dark:bg-background-dark z-20">
              <div class="p-4 border-b border-slate-100 dark:border-slate-800">
                <h3 class="font-bold text-sm uppercase tracking-widest text-slate-400">Node Properties</h3>
              </div>
              <div class="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar" data-scroll-preserve="editor-properties">
                <!-- Node Label -->
                <div class="space-y-3">
                  <label class="block text-xs font-medium text-slate-500 mb-1.5">Node Label</label>
                  <input id="prop-label" class="ui-input" value="${node.label}" />
                </div>

                <!-- Node Icon -->
                <div class="space-y-3">
                  <label class="block text-xs font-medium text-slate-500 mb-1.5">Node Icon</label>
                  <div class="flex items-center gap-2">
                    <div class="w-9 h-9 rounded flex items-center justify-center shrink-0" style="background:${previewStyles.headerBackground}; color:${previewStyles.icon}; border:1px solid ${previewStyles.headerBorder};">
                      <span id="prop-icon-preview" class="material-icons text-base">${currentIcon}</span>
                    </div>
                    <div class="relative flex-1">
                      <select
                        id="prop-icon"
                        class="ui-select appearance-none cursor-pointer"
                      >
                        ${NODE_ICON_SUGGESTIONS.map((icon) => `
                          <option value="${icon}" ${icon === currentIcon ? 'selected' : ''}>${icon}</option>
                        `).join('')}
                      </select>
                      <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        <span class="material-icons text-sm">expand_more</span>
                      </div>
                    </div>
                  </div>
                  <!-- Icon Grid Dropdown -->
                  <div class="relative">
                    <button type="button" id="icon-grid-toggle" class="w-full py-2 px-3 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 rounded border border-primary/20 transition-colors flex items-center justify-center gap-2">
                      <span class="material-icons text-sm">grid_view</span>
                      Browse Icons
                    </button>
                    <div id="icon-grid-dropdown" class="hidden absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl max-h-64 overflow-y-auto custom-scrollbar">
                      <div class="p-2 grid grid-cols-6 gap-1">
                        ${NODE_ICON_SUGGESTIONS.map((icon) => `
                          <button type="button" class="icon-grid-option p-2 rounded hover:bg-primary/10 transition-colors flex flex-col items-center gap-0.5 ${icon === currentIcon ? 'bg-primary/20 ring-1 ring-primary' : ''}" data-icon="${icon}">
                            <span class="material-icons text-lg">${icon}</span>
                            <span class="text-[8px] text-slate-400 truncate w-full text-center">${icon}</span>
                          </button>
                        `).join('')}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Node Color -->
                <div class="space-y-3">
                  <label class="block text-xs font-medium text-slate-500 mb-1.5">Node Color</label>
                  <div class="flex items-center gap-2">
                    <input id="prop-node-color" type="color" class="h-9 w-12 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer" value="${previewColor}" />
                    <div class="flex flex-wrap gap-1.5">
                      ${colorPalette.slice(0, 8).map((color) => `
                        <button type="button" class="node-color-swatch h-6 w-6 rounded-full border-2 transition-transform hover:scale-105 ${color === previewColor ? 'border-slate-700 dark:border-slate-200' : 'border-white dark:border-slate-800'}" data-color="${color}" style="background:${color};"></button>
                      `).join('')}
                    </div>
                    <button id="btn-reset-node-color" type="button" class="ml-auto text-[11px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Reset</button>
                  </div>
                  <p class="text-[10px] text-slate-400">Color persists with this node and controls its canvas card styling.</p>
                </div>

                <!-- Model Override -->
                <div class="pt-4 border-t border-slate-100 dark:border-slate-800">
                  <h3 class="font-bold text-sm uppercase tracking-widest text-slate-400 mb-4">Meta Information</h3>
                  <div class="space-y-4">
                    <div>
                      <label class="block text-xs font-medium text-slate-500 mb-1.5">Model Override</label>
                      <select id="prop-model" class="ui-select">
                        <option ${project.model === 'GPT-4o' ? 'selected' : ''}>GPT-4o</option>
                        <option ${project.model === 'Claude 3.5' ? 'selected' : ''}>Claude 3.5</option>
                        <option ${project.model === 'GPT-4 Turbo' ? 'selected' : ''}>GPT-4 Turbo</option>
                        <option ${project.model === 'Llama 3' ? 'selected' : ''}>Llama 3</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Panel Footer -->
              <div class="p-4 bg-slate-50/50 dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-800">
                <button id="btn-update" class="w-full py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs rounded hover:opacity-90 transition-opacity">
                  SAVE AND CLOSE
                </button>
              </div>
            </aside>
          </main>
        </div>
      </div>

      <!-- Floating Token Legend -->
      ${tokenizerActive ? `
      <div id="token-legend" class="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-[30rem] z-[910] bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-2xl flex flex-col gap-3">
        <div class="flex items-center justify-between gap-8">
          <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tokenizer Legend</span>
          <button id="close-legend" class="text-slate-400 hover:text-slate-600"><span class="material-icons text-sm">close</span></button>
        </div>
        <div class="flex gap-2">
          <div class="flex items-center gap-1.5">
            <div class="w-3 h-3 rounded-sm bg-primary/20 border-b-2 border-primary/40"></div>
            <span class="text-[10px] font-medium text-slate-600 dark:text-slate-400">ID 01</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-3 h-3 rounded-sm bg-blue-500/20 border-b-2 border-blue-500/40"></div>
            <span class="text-[10px] font-medium text-slate-600 dark:text-slate-400">ID 02</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-3 h-3 rounded-sm bg-purple-500/20 border-b-2 border-purple-500/40"></div>
            <span class="text-[10px] font-medium text-slate-600 dark:text-slate-400">ID 03</span>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-3 h-3 rounded-sm bg-amber-500/20 border-b-2 border-amber-500/40"></div>
            <span class="text-[10px] font-medium text-slate-600 dark:text-slate-400">ID 04</span>
          </div>
        </div>
        <div class="mt-1 pt-3 border-t border-slate-100 dark:border-slate-800">
          <p class="text-[11px] text-slate-500 leading-tight">Tokens represent the basic units of text processed by the LLM. Colors alternate to show word and sub-word boundaries.</p>
        </div>
      </div>
      ` : ''}
      `;
    });

    wireEvents();
  }

  function wireEvents(): void {
    const textarea = container.querySelector<HTMLTextAreaElement>('#editor-textarea');
    const highlightLayer = container.querySelector<HTMLElement>('#highlight-layer');
    const tokenCountEl = container.querySelector<HTMLElement>('#token-count');

    if (!textarea || !highlightLayer || !tokenCountEl) return;

    // Preserve leading newlines exactly. Avoid populating via innerHTML.
    textarea.value = currentContent;
    textarea.focus();

    textarea.addEventListener('input', () => {
      currentContent = normalizeLineEndings(textarea.value);
      highlightLayer.innerHTML = toHighlightedHTML(currentContent, tokenizerActive);
      tokenCountEl.textContent = String(countTokens(currentContent));
    });

    textarea.addEventListener('scroll', () => {
      highlightLayer.scrollTop = textarea.scrollTop;
      highlightLayer.scrollLeft = textarea.scrollLeft;
    });

    container.querySelector('#btn-toggle-tokenizer')?.addEventListener('click', () => {
      tokenizerActive = !tokenizerActive;
      render();
    });

    container.querySelectorAll<HTMLElement>('.format-btn').forEach((button) => {
      button.addEventListener('click', () => {
        editorFormat = button.dataset.format as EditorFormat;
        render();
      });
    });

    container.querySelector('#close-legend')?.addEventListener('click', () => {
      container.querySelector('#token-legend')?.remove();
    });

    container.querySelector('#btn-save-version')?.addEventListener('click', () => {
      persistDraft();
      const version = store.saveCurrentState(projectId);
      const button = container.querySelector<HTMLButtonElement>('#btn-save-version');
      if (!button) return;
      button.innerHTML = version
        ? '<span class="material-icons text-sm">check</span> State saved'
        : '<span class="material-icons text-sm">info</span> No changes';
      setTimeout(() => {
        button.innerHTML = '<span class="material-icons text-sm">save</span> Save Current State';
      }, 2000);
    });

    container.querySelector('#btn-save-custom-node')?.addEventListener('click', async () => {
      persistDraft();
      const templateLabel = (await customPrompt('Custom node template name:', node.label) ?? '').trim();
      if (!templateLabel) return;
      store.saveCustomNodeTemplate({
        type: node.type,
        label: templateLabel,
        icon: node.icon,
        content: node.content,
        meta: { ...node.meta },
      });
      const button = container.querySelector<HTMLButtonElement>('#btn-save-custom-node');
      if (!button) return;
      button.innerHTML = '<span class="material-icons text-sm">check</span> Saved';
      setTimeout(() => {
        button.innerHTML = '<span class="material-icons text-sm">bookmark_add</span> Save Custom Node';
      }, 1800);
    });

    container.querySelector('#btn-update')?.addEventListener('click', () => {
      closeToCanvas();
    });

    container.querySelector('#btn-export-runtime')?.addEventListener('click', () => {
      persistDraft();
      navigator.clipboard.writeText(store.assemblePrompt(projectId, 'runtime'));
    });

    container.querySelector('#btn-export-flow')?.addEventListener('click', () => {
      persistDraft();
      navigator.clipboard.writeText(store.assemblePrompt(projectId, 'flow-template'));
    });

    container.querySelector('#prop-label')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLInputElement).value.trim();
      if (value) {
        node.label = value;
        store.updateNode(projectId, nodeId, { label: value });
      }
    });

    const iconInput = container.querySelector<HTMLSelectElement>('#prop-icon');
    const nodeIconPreview = container.querySelector<HTMLElement>('#node-icon-preview');
    const propIconPreview = container.querySelector<HTMLElement>('#prop-icon-preview');
    const iconGridToggle = container.querySelector<HTMLButtonElement>('#icon-grid-toggle');
    const iconGridDropdown = container.querySelector<HTMLElement>('#icon-grid-dropdown');
    const colorInput = container.querySelector<HTMLInputElement>('#prop-node-color');
    const resetColorButton = container.querySelector<HTMLButtonElement>('#btn-reset-node-color');

    const syncIconPreview = (iconName: string): void => {
      if (nodeIconPreview) nodeIconPreview.textContent = iconName;
      if (propIconPreview) propIconPreview.textContent = iconName;
      // Update the select dropdown
      if (iconInput) iconInput.value = iconName;
      // Update grid button selection
      container.querySelectorAll('.icon-grid-option').forEach(btn => {
        const isSelected = btn.getAttribute('data-icon') === iconName;
        btn.classList.toggle('bg-primary/20', isSelected);
        btn.classList.toggle('ring-1', isSelected);
        btn.classList.toggle('ring-primary', isSelected);
      });
    };

    const syncColorPreview = (hexColor: string): void => {
      const normalized = normalizeNodeColor(hexColor) ?? DEFAULT_NODE_COLOR;
      const nextStyles = buildNodeColorStyles(normalized);
      currentNodeColor = normalized;
      if (colorInput) colorInput.value = normalized;

      [nodeIconPreview?.parentElement, propIconPreview?.parentElement].forEach((host) => {
        if (!host) return;
        host.style.background = nextStyles.headerBackground;
        host.style.color = nextStyles.icon;
        host.style.border = `1px solid ${nextStyles.headerBorder}`;
      });

      container.querySelectorAll<HTMLElement>('.node-color-swatch').forEach((button) => {
        const isSelected = button.dataset.color === normalized;
        button.classList.toggle('border-slate-700', isSelected);
        button.classList.toggle('dark:border-slate-200', isSelected);
        button.classList.toggle('border-white', !isSelected);
        button.classList.toggle('dark:border-slate-800', !isSelected);
      });
    };

    // Toggle icon grid dropdown
    iconGridToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      iconGridDropdown?.classList.toggle('hidden');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#icon-grid-dropdown') && !target.closest('#icon-grid-toggle')) {
        iconGridDropdown?.classList.add('hidden');
      }
    });

    // Handle icon grid selection
    container.querySelectorAll<HTMLElement>('.icon-grid-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedIcon = btn.getAttribute('data-icon') || 'widgets';
        currentIcon = selectedIcon;
        node.icon = selectedIcon;
        syncIconPreview(selectedIcon);
        store.updateNode(projectId, nodeId, { icon: selectedIcon });
        iconGridDropdown?.classList.add('hidden');
      });
    });

    iconInput?.addEventListener('change', () => {
      const nextIcon = normalizeIconName(iconInput.value) || 'widgets';
      currentIcon = nextIcon;
      node.icon = nextIcon;
      syncIconPreview(nextIcon);
      store.updateNode(projectId, nodeId, { icon: nextIcon });
    });

    colorInput?.addEventListener('input', () => {
      const nextColor = normalizeNodeColor(colorInput.value) ?? DEFAULT_NODE_COLOR;
      syncColorPreview(nextColor);
      const nextMeta = withNodeColorMeta(node.meta, nextColor);
      node.meta = nextMeta;
      store.updateNode(projectId, nodeId, { meta: nextMeta });
    });

    container.querySelectorAll<HTMLElement>('.node-color-swatch').forEach((button) => {
      button.addEventListener('click', () => {
        const nextColor = normalizeNodeColor(button.dataset.color) ?? DEFAULT_NODE_COLOR;
        syncColorPreview(nextColor);
        const nextMeta = withNodeColorMeta(node.meta, nextColor);
        node.meta = nextMeta;
        store.updateNode(projectId, nodeId, { meta: nextMeta });
      });
    });

    resetColorButton?.addEventListener('click', () => {
      const nextColor = getAutoNodeColor(0);
      syncColorPreview(nextColor);
      const nextMeta = withNodeColorMeta(node.meta, nextColor);
      node.meta = nextMeta;
      store.updateNode(projectId, nodeId, { meta: nextMeta });
    });

    container.querySelector('#btn-back-canvas')?.addEventListener('click', () => closeToCanvas());
    container.querySelector('#btn-close-editor')?.addEventListener('click', () => closeToCanvas());
    container.querySelector('#nav-home')?.addEventListener('click', () => {
      persistDraft();
      router.navigate('/');
    });

    const overlay = container.querySelector<HTMLElement>('#editor-overlay');
    overlay?.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeToCanvas();
      }
    });

    wireProjectViewTabs(container, projectId, {
      beforeNavigate: () => {
        persistDraft();
      },
    });

    wireEscapeToCanvas(container, projectId, {
      onEscape: () => {
        persistDraft();
      },
    });

    wireThemeToggle(container);
  }

  render();
}
