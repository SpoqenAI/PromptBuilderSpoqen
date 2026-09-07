import {
  PROMPT_BLOCK_PALETTE,
  TRANSCRIPT_BLOCK_PALETTE,
  type BlockDefinition,
  type CustomNodeTemplate,
} from '../../models';
import {
  MIN_CANVAS_SIDEBAR_WIDTH,
  MAX_CANVAS_SIDEBAR_WIDTH,
  type SidebarBlock,
  type WorkspaceMode,
} from './types';

const sidebarLabelMeasureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const sidebarLabelMeasureCtx = sidebarLabelMeasureCanvas?.getContext('2d') ?? null;
export const canvasSidebarCategoryCollapsed = new Set<string>();

export function escapeHTML(str: string): string {
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function estimateSidebarLabelPixelWidth(label: string): number {
  const text = label.trim().length > 0 ? label : 'Node';
  if (!sidebarLabelMeasureCtx) return text.length * 7;
  sidebarLabelMeasureCtx.font = '500 12px Inter, system-ui, -apple-system, sans-serif';
  return Math.ceil(sidebarLabelMeasureCtx.measureText(text).width);
}

export function computeRecommendedSidebarWidth(categories: Map<string, SidebarBlock[]>): number {
  let longestLabelWidth = 0;
  for (const blocks of categories.values()) {
    for (const block of blocks) {
      longestLabelWidth = Math.max(longestLabelWidth, estimateSidebarLabelPixelWidth(block.label));
    }
  }
  const sidebarChromeWidth = 108;
  const calculated = longestLabelWidth + sidebarChromeWidth;
  return Math.max(MIN_CANVAS_SIDEBAR_WIDTH, Math.min(MAX_CANVAS_SIDEBAR_WIDTH, calculated));
}

export function resolveWorkspacePalette(mode: WorkspaceMode): ReadonlyArray<BlockDefinition> {
  return mode === 'transcript' ? TRANSCRIPT_BLOCK_PALETTE : PROMPT_BLOCK_PALETTE;
}

export function buildSidebarCategories(
  customTemplates: CustomNodeTemplate[],
  mode: WorkspaceMode,
): Map<string, SidebarBlock[]> {
  const categories = new Map<string, SidebarBlock[]>();
  for (const block of resolveWorkspacePalette(mode)) {
    if (!categories.has(block.category)) categories.set(block.category, []);
    categories.get(block.category)!.push({
      type: block.type,
      label: block.label,
      icon: block.icon,
      category: block.category,
      defaultContent: block.defaultContent,
      meta: {},
      isCustomTemplate: false,
    });
  }

  const customCategory = mode === 'transcript'
    ? 'My Transcript Templates'
    : 'My Custom Nodes';
  categories.set(customCategory, customTemplates.map((template) => ({
    type: template.type,
    label: template.label,
    icon: template.icon,
    category: customCategory,
    defaultContent: template.content,
    meta: { ...template.meta },
    templateId: template.id,
    isCustomTemplate: true,
  })));

  return categories;
}

export function renderSidebarBlocksHTML(categories: Map<string, SidebarBlock[]>): string {
  return [...categories.entries()].map(([category, blocks]) => {
    const isCustomCategory =
      category === 'My Custom Nodes' || category === 'My Transcript Templates';
    const customEmptyState = isCustomCategory && blocks.length === 0
      ? `<p class="px-2 py-2 text-[11px] text-slate-400">Save any canvas node as a template to reuse it here.</p>`
      : '';

    const isCollapsed = canvasSidebarCategoryCollapsed.has(category);

    return `
      <section data-category="${escapeHTML(category)}" class="group/category" data-collapsed="${isCollapsed ? 'true' : 'false'}">
        <button type="button" class="sidebar-category-toggle w-full flex items-center justify-between px-2 py-1 mb-1.5 -mx-2 text-left rounded hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus:outline-none" aria-expanded="${!isCollapsed}">
          <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${escapeHTML(category)}</span>
          <span class="material-icons text-sm text-slate-400 transition-transform duration-200 group-data-[collapsed=true]/category:-rotate-90">expand_more</span>
        </button>
        <div class="space-y-1 overflow-hidden group-data-[collapsed=true]/category:hidden">
          ${blocks.map((block) => {
      const encodedMeta = encodeURIComponent(JSON.stringify(block.meta));
      return `
              <div
                class="sidebar-block group flex items-center gap-3 p-2 rounded cursor-grab hover:bg-slate-100 dark:hover:bg-white/5 transition-colors border border-transparent hover:border-primary/20"
                draggable="true"
                data-type="${block.type}"
                data-label="${escapeHTML(block.label)}"
                data-icon="${escapeHTML(block.icon)}"
                data-default="${encodeURIComponent(block.defaultContent)}"
                data-meta="${encodedMeta}"
                data-template-id="${block.templateId ?? ''}"
                data-is-custom="${block.isCustomTemplate ? '1' : '0'}"
              >
                <span class="material-icons text-sm text-primary">${escapeHTML(block.icon)}</span>
                <span class="text-xs font-medium truncate">${escapeHTML(block.label)}</span>
                ${block.isCustomTemplate
          ? `<button type="button" class="sidebar-custom-delete ml-auto p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors" data-template-id="${block.templateId ?? ''}" title="Delete custom node template">
                      <span class="material-icons text-sm">delete_outline</span>
                    </button>`
          : ''}
              </div>
            `;
    }).join('')}
          ${customEmptyState}
        </div>
      </section>
    `;
  }).join('');
}
