import type { TranscriptFlowNode } from '../../transcript-flow';
import { resolveNodeIcon } from '../../node-icons';
import { esc } from './format';

export interface OpenNodeEditorModalOptions {
  onSave: (next: {
    label: string;
    content: string;
    type: TranscriptFlowNode['type'];
  }) => void;
}

export function openNodeEditorModal(
  node: TranscriptFlowNode,
  options: OpenNodeEditorModalOptions,
): void {
  const overlay = document.createElement('div');
  overlay.className =
    'fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200';

  const dialog = document.createElement('div');
  dialog.className =
    'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-xl p-0 animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]';

  const safeIcon = resolveNodeIcon(node.icon, node.type);

  dialog.innerHTML = `
    <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-icons text-base text-primary shrink-0">${safeIcon}</span>
        <span class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">Edit Node</span>
      </div>
      <button id="modal-close-btn" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer" title="Close">
        <span class="material-icons text-lg">close</span>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
      <div>
        <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Label</label>
        <input id="node-edit-label" type="text" value="${esc(node.label)}" class="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-primary/50 focus:outline-none text-sm text-zinc-900 dark:text-zinc-100" />
      </div>
      <div>
        <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Type</label>
        <input id="node-edit-type" type="text" value="${esc(node.type)}" class="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-600 dark:text-zinc-400" />
      </div>
      <div>
        <label class="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Content</label>
        <textarea id="node-edit-content" rows="12" class="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono text-xs leading-relaxed focus:ring-2 focus:ring-primary/50 focus:outline-none text-zinc-900 dark:text-zinc-100 custom-scrollbar resize-y">${esc(node.content)}</textarea>
      </div>
      ${Object.keys(node.meta).length > 0
    ? `
      <div>
        <span class="block text-[9px] uppercase tracking-wider text-zinc-400 mb-1">Metadata</span>
        ${Object.entries(node.meta).map(([k, v]) => `<div class="text-[11px] text-zinc-500"><span class="font-medium">${esc(k)}:</span> ${esc(v)}</div>`).join('')}
      </div>
      `
    : ''}
    </div>
    <div class="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800">
      <button id="modal-cancel-btn" class="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm">Cancel</button>
      <button id="modal-save-btn" class="px-4 py-2 bg-black dark:bg-white text-white dark:text-black rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors text-sm">Save Changes</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const labelInput = dialog.querySelector<HTMLInputElement>('#node-edit-label');
  const contentArea = dialog.querySelector<HTMLTextAreaElement>('#node-edit-content');
  const typeInput = dialog.querySelector<HTMLInputElement>('#node-edit-type');
  if (!labelInput || !contentArea || !typeInput) {
    document.body.removeChild(overlay);
    return;
  }

  labelInput.focus({ preventScroll: true });
  labelInput.select();

  const cleanup = () => {
    document.body.removeChild(overlay);
    document.removeEventListener('keydown', handleKeyDown);
  };

  const save = () => {
    options.onSave({
      label: labelInput.value.trim() || node.label,
      content: contentArea.value,
      type: (typeInput.value.trim() || node.type) as TranscriptFlowNode['type'],
    });
    cleanup();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanup();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      save();
    }
  };

  dialog.querySelector('#modal-close-btn')?.addEventListener('click', cleanup);
  dialog.querySelector('#modal-cancel-btn')?.addEventListener('click', cleanup);
  dialog.querySelector('#modal-save-btn')?.addEventListener('click', save);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) cleanup();
  });
  document.addEventListener('keydown', handleKeyDown);
}
