import {
  buildNodeColorStyles,
  DEFAULT_NODE_COLOR,
  NODE_AUTO_COLORS,
  normalizeNodeColor,
  readNodeColorMeta,
  withNodeColorMeta,
} from '../../node-colors';
import type { TranscriptFlowNode } from '../../transcript-flow';
import { resolveNodeIcon } from '../../node-icons';
import { esc } from './format';

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
  'settings',
  'timeline',
  'link',
  'dns',
] as const;

export interface OpenNodeEditorModalOptions {
  onSave: (next: {
    label: string;
    content: string;
    type: TranscriptFlowNode['type'];
    icon: string;
    meta: Record<string, string>;
  }) => void;
}

export function openNodeEditorModal(
  node: TranscriptFlowNode,
  options: OpenNodeEditorModalOptions,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4';

  const dialog = document.createElement('div');
  dialog.className = 'w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col';
  overlay.appendChild(dialog);

  const initialColor = readNodeColorMeta(node.meta) ?? DEFAULT_NODE_COLOR;
  const initialIcon = resolveNodeIcon(node.icon, node.type);
  const iconOptions = Array.from(new Set([...NODE_ICON_SUGGESTIONS, initialIcon]));

  dialog.innerHTML = `
    <div class="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">Edit Transcript Node</h2>
        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Same editing controls as canvas nodes.</p>
      </div>
      <button id="modal-close-btn" class="h-8 w-8 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10">
        <span class="material-icons text-sm">close</span>
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_20rem] gap-0 flex-1 min-h-0">
      <div class="p-5 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 overflow-y-auto custom-scrollbar space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Label</label>
          <input id="node-edit-label" type="text" value="${esc(node.label)}" class="ui-input" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Type</label>
          <input id="node-edit-type" type="text" value="${esc(node.type)}" class="ui-input" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Content</label>
          <textarea id="node-edit-content" rows="14" class="ui-input resize-y min-h-44 font-mono text-xs leading-relaxed">${esc(node.content)}</textarea>
        </div>
      </div>

      <aside class="p-5 overflow-y-auto custom-scrollbar space-y-4 bg-slate-50/50 dark:bg-slate-900/40">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Icon</label>
          <select id="node-edit-icon" class="ui-select">
            ${iconOptions.map((icon) => `
              <option value="${icon}" ${icon === initialIcon ? 'selected' : ''}>${icon}</option>
            `).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">Node Color</label>
          <div class="flex items-center gap-2">
            <input id="node-edit-color" type="color" value="${initialColor}" class="h-9 w-12 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer" />
            <div class="flex flex-wrap gap-1.5">
              ${[initialColor, ...NODE_AUTO_COLORS.filter((color) => color !== initialColor)].slice(0, 8).map((color) => `
                <button type="button" class="node-color-swatch h-6 w-6 rounded-full border-2 ${color === initialColor ? 'border-slate-700 dark:border-slate-200' : 'border-white dark:border-slate-800'}" data-node-color="${color}" style="background:${color};"></button>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3">
          <div class="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Preview</div>
          <div id="node-preview" class="rounded-lg border shadow-sm">
            <div id="node-preview-header" class="rounded-t-lg px-3 py-2 border-b flex items-center gap-2">
              <span id="node-preview-icon" class="material-icons text-sm">${initialIcon}</span>
              <span id="node-preview-label" class="text-xs font-semibold truncate">${esc(node.label || 'Node')}</span>
            </div>
            <div class="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">Realtime style preview</div>
          </div>
        </div>
      </aside>
    </div>

    <div class="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
      <button id="modal-cancel-btn" class="ui-btn ui-btn-ghost">Cancel</button>
      <button id="modal-save-btn" class="ui-btn ui-btn-primary">Save Changes</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const labelInput = dialog.querySelector<HTMLInputElement>('#node-edit-label');
  const typeInput = dialog.querySelector<HTMLInputElement>('#node-edit-type');
  const contentInput = dialog.querySelector<HTMLTextAreaElement>('#node-edit-content');
  const iconInput = dialog.querySelector<HTMLSelectElement>('#node-edit-icon');
  const colorInput = dialog.querySelector<HTMLInputElement>('#node-edit-color');
  const preview = dialog.querySelector<HTMLElement>('#node-preview');
  const previewHeader = dialog.querySelector<HTMLElement>('#node-preview-header');
  const previewIcon = dialog.querySelector<HTMLElement>('#node-preview-icon');
  const previewLabel = dialog.querySelector<HTMLElement>('#node-preview-label');
  if (
    !labelInput
    || !typeInput
    || !contentInput
    || !iconInput
    || !colorInput
    || !preview
    || !previewHeader
    || !previewIcon
    || !previewLabel
  ) {
    overlay.remove();
    return;
  }

  let currentColor = normalizeNodeColor(colorInput.value) ?? DEFAULT_NODE_COLOR;

  const applyPreview = (): void => {
    const styles = buildNodeColorStyles(currentColor);
    preview.style.borderColor = styles.border;
    previewHeader.style.background = styles.headerBackground;
    previewHeader.style.borderBottomColor = styles.headerBorder;
    previewIcon.style.color = styles.icon;
    previewIcon.textContent = iconInput.value;
    previewLabel.textContent = labelInput.value.trim() || 'Node';
    colorInput.value = currentColor;
    dialog.querySelectorAll<HTMLElement>('.node-color-swatch').forEach((swatch) => {
      const isSelected = swatch.dataset.nodeColor === currentColor;
      swatch.classList.toggle('border-slate-700', isSelected);
      swatch.classList.toggle('dark:border-slate-200', isSelected);
      swatch.classList.toggle('border-white', !isSelected);
      swatch.classList.toggle('dark:border-slate-800', !isSelected);
    });
  };
  applyPreview();

  const cleanup = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', handleKeyDown);
  };

  const save = (): void => {
    const normalizedColor = normalizeNodeColor(colorInput.value) ?? currentColor;
    currentColor = normalizedColor;
    options.onSave({
      label: labelInput.value.trim() || node.label,
      content: contentInput.value,
      type: (typeInput.value.trim() || node.type) as TranscriptFlowNode['type'],
      icon: iconInput.value.trim() || node.icon,
      meta: withNodeColorMeta(node.meta, currentColor),
    });
    cleanup();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanup();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  };

  labelInput.addEventListener('input', applyPreview);
  iconInput.addEventListener('change', applyPreview);
  colorInput.addEventListener('input', () => {
    currentColor = normalizeNodeColor(colorInput.value) ?? currentColor;
    applyPreview();
  });
  dialog.querySelectorAll<HTMLButtonElement>('.node-color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      const nextColor = normalizeNodeColor(swatch.dataset.nodeColor) ?? DEFAULT_NODE_COLOR;
      currentColor = nextColor;
      applyPreview();
    });
  });

  dialog.querySelector('#modal-close-btn')?.addEventListener('click', cleanup);
  dialog.querySelector('#modal-cancel-btn')?.addEventListener('click', cleanup);
  dialog.querySelector('#modal-save-btn')?.addEventListener('click', save);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) cleanup();
  });
  document.addEventListener('keydown', handleKeyDown);

  labelInput.focus({ preventScroll: true });
  labelInput.select();
}
