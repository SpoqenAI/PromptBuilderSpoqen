/**
 * Import Wizard View — 3-step flow to import an existing prompt,
 * split it into sections, and create nodes on a canvas.
 *
 * Step 1: Paste prompt text + project metadata
 * Step 2: Interactive section splitter (click between lines to add dividers)
 * Step 3: Review sections & create project
 */
import { store } from '../store';
import { router } from '../router';
import { BLOCK_PALETTE, PromptNode, NodeType, uid, type EditorFormat } from '../models';
import { themeToggleHTML, wireThemeToggle } from '../theme';

/* ── Types ────────────────────────────────────── */

interface Section {
  id: string;
  label: string;
  type: NodeType;
  icon: string;
  startLine: number; // inclusive, 0-based
  endLine: number;   // inclusive, 0-based
}

interface SectionSeed {
  startLine: number;
  endLine: number;
  label?: string;
}

/* ── Palette options for the type picker ─────── */

const NODE_TYPE_OPTIONS = BLOCK_PALETTE.map(b => ({
  type: b.type,
  label: b.label,
  icon: b.icon,
}));

const DEFAULT_SECTION_LABEL = 'N/A';
const DEFAULT_SECTION_TYPE: NodeType = 'custom';
const DEFAULT_SECTION_ICON = 'widgets';
const SECTION_ICON_OPTIONS = Array.from(new Set<string>([
  DEFAULT_SECTION_ICON,
  ...BLOCK_PALETTE.map(b => b.icon),
]));

/* ── Color palette for section highlighting ───── */

const SECTION_COLORS = [
  { bg: 'rgba(35, 149, 111, 0.12)', border: '#23956F' },
  { bg: 'rgba(59, 130, 246, 0.12)', border: '#3B82F6' },
  { bg: 'rgba(139, 92, 246, 0.12)', border: '#8B5CF6' },
  { bg: 'rgba(245, 158, 11, 0.12)', border: '#F59E0B' },
  { bg: 'rgba(236, 72, 153, 0.12)', border: '#EC4899' },
  { bg: 'rgba(20, 184, 166, 0.12)', border: '#14B8A6' },
  { bg: 'rgba(239, 68, 68, 0.12)', border: '#EF4444' },
  { bg: 'rgba(99, 102, 241, 0.12)', border: '#6366F1' },
];

function getColor(index: number) {
  return SECTION_COLORS[index % SECTION_COLORS.length];
}

/* ── Escape helper ────────────────────────────── */

function esc(str: string): string {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n?/g, '\n');
}

/* ── Guess a node type from content ───────────── */

function normalizeIconName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function createDefaultSection(startLine: number, endLine: number, label = DEFAULT_SECTION_LABEL): Section {
  return {
    id: uid(),
    label: label.trim() || DEFAULT_SECTION_LABEL,
    type: DEFAULT_SECTION_TYPE,
    icon: DEFAULT_SECTION_ICON,
    startLine,
    endLine,
  };
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

function hasNonBlankContent(lines: string[], startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (!isBlankLine(lines[i] ?? '')) return true;
  }
  return false;
}

function extractParagraphSectionSeeds(lines: string[]): SectionSeed[] {
  const seeds: SectionSeed[] = [];
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isDoubleBreak = line === '' && i + 1 < lines.length && lines[i + 1].trim() === '';

    if (i > currentStart && isDoubleBreak) {
      let endLine = i - 1;
      while (endLine > currentStart && isBlankLine(lines[endLine])) endLine--;
      if (endLine >= currentStart) {
        seeds.push({ startLine: currentStart, endLine });
      }

      let nextStart = i;
      while (nextStart < lines.length && isBlankLine(lines[nextStart])) nextStart++;
      currentStart = nextStart;
      i = nextStart - 1;
    }
  }

  if (currentStart < lines.length) {
    let endLine = lines.length - 1;
    while (endLine > currentStart && isBlankLine(lines[endLine])) endLine--;
    if (endLine >= currentStart) {
      seeds.push({ startLine: currentStart, endLine });
    }
  }

  return seeds;
}

function extractMarkdownSectionSeeds(lines: string[]): SectionSeed[] {
  const headingRegex = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
  const headings: Array<{ line: number; label: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headingRegex);
    if (!match) continue;
    const label = match[1].trim();
    headings.push({ line: i, label });
  }

  if (headings.length === 0) {
    return extractParagraphSectionSeeds(lines);
  }

  const seeds: SectionSeed[] = [];
  if (headings[0].line > 0) {
    seeds.push({ startLine: 0, endLine: headings[0].line - 1 });
  }

  for (let i = 0; i < headings.length; i++) {
    const startLine = headings[i].line;
    const endLine = i < headings.length - 1 ? headings[i + 1].line - 1 : lines.length - 1;
    seeds.push({ startLine, endLine, label: headings[i].label });
  }

  return seeds;
}

function extractXmlSectionSeeds(lines: string[]): SectionSeed[] {
  const topLevelSeeds: SectionSeed[] = [];
  const childSeeds: SectionSeed[] = [];
  const openTagRegex = /^<([A-Za-z_][\w.-]*)(?:\s+[^<>]*)?>\s*$/;
  const closeTagRegex = /^<\/([A-Za-z_][\w.-]*)>\s*$/;
  const selfClosingTagRegex = /^<([A-Za-z_][\w.-]*)(?:\s+[^<>]*)?\/>\s*$/;
  const inlineTagRegex = /^<([A-Za-z_][\w.-]*)(?:\s+[^<>]*)?>[\s\S]*<\/\1>\s*$/;
  const stack: Array<{ name: string; startLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;

    if (stack.length === 0) {
      const inlineMatch = trimmed.match(inlineTagRegex);
      if (inlineMatch) {
        topLevelSeeds.push({ startLine: i, endLine: i, label: inlineMatch[1] });
        continue;
      }

      const selfClosingMatch = trimmed.match(selfClosingTagRegex);
      if (selfClosingMatch) {
        topLevelSeeds.push({ startLine: i, endLine: i, label: selfClosingMatch[1] });
        continue;
      }
    } else if (stack.length === 1) {
      const inlineMatch = trimmed.match(inlineTagRegex);
      if (inlineMatch) {
        childSeeds.push({ startLine: i, endLine: i, label: inlineMatch[1] });
        continue;
      }

      const selfClosingMatch = trimmed.match(selfClosingTagRegex);
      if (selfClosingMatch) {
        childSeeds.push({ startLine: i, endLine: i, label: selfClosingMatch[1] });
        continue;
      }
    }

    const openMatch = trimmed.match(openTagRegex);
    if (openMatch && !trimmed.startsWith('</') && !trimmed.endsWith('/>')) {
      stack.push({ name: openMatch[1], startLine: i });
      continue;
    }

    const closeMatch = trimmed.match(closeTagRegex);
    if (!closeMatch || stack.length === 0) continue;

    const top = stack[stack.length - 1];
    if (top.name !== closeMatch[1]) continue;
    stack.pop();
    if (stack.length === 0) {
      topLevelSeeds.push({ startLine: top.startLine, endLine: i, label: top.name });
    } else if (stack.length === 1) {
      childSeeds.push({ startLine: top.startLine, endLine: i, label: top.name });
    }
  }

  return childSeeds.length > 0 ? childSeeds : topLevelSeeds;
}

function buildSectionsFromSeeds(lines: string[], seeds: SectionSeed[]): Section[] {
  if (lines.length === 0) return [];
  const lastLine = lines.length - 1;
  const orderedSeeds = [...seeds]
    .map(seed => ({
      startLine: Math.max(0, Math.min(lastLine, seed.startLine)),
      endLine: Math.max(0, Math.min(lastLine, seed.endLine)),
      label: seed.label,
    }))
    .filter(seed => seed.endLine >= seed.startLine)
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

  const sections: Section[] = [];
  let cursor = 0;

  const pushSection = (startLine: number, endLine: number, label = DEFAULT_SECTION_LABEL): void => {
    if (startLine > endLine) return;
    if (!hasNonBlankContent(lines, startLine, endLine)) return;
    sections.push(createDefaultSection(startLine, endLine, label));
  };

  for (const seed of orderedSeeds) {
    if (seed.endLine < cursor) continue;
    const startLine = Math.max(seed.startLine, cursor);
    if (startLine > lastLine) break;

    if (startLine > cursor) {
      pushSection(cursor, startLine - 1);
    }

    const endLine = Math.max(startLine, seed.endLine);
    pushSection(startLine, endLine, seed.label);
    cursor = endLine + 1;
  }

  if (cursor <= lastLine) {
    pushSection(cursor, lastLine);
  }

  if (sections.length === 0) {
    return [createDefaultSection(0, lastLine)];
  }

  return sections;
}

function buildSectionSourceKey(text: string, format: EditorFormat): string {
  return `${format}::${text}`;
}

/* ── Main render ─────────────────────────────── */

export function renderImport(container: HTMLElement): void {
  let step = 1;
  let promptText = '';
  let projectName = 'Imported Prompt';
  let projectModel = 'GPT-4o';
  let importFormat: EditorFormat = 'markdown';
  let lines: string[] = [];
  let sections: Section[] = [];
  let lastSectionSourceKey = '';
  let step2SplitScrollTop = 0;
  let step2SplitScrollLeft = 0;
  let step2SectionsScrollTop = 0;

  function autoExtractSections(): Section[] {
    const seeds = importFormat === 'xml'
      ? extractXmlSectionSeeds(lines)
      : extractMarkdownSectionSeeds(lines);
    return buildSectionsFromSeeds(lines, seeds);
  }

  function captureStep2Scroll(): void {
    const splitContent = container.querySelector<HTMLElement>('#split-content');
    const sectionsList = container.querySelector<HTMLElement>('#sections-list');
    if (splitContent) {
      step2SplitScrollTop = splitContent.scrollTop;
      step2SplitScrollLeft = splitContent.scrollLeft;
    }
    if (sectionsList) {
      step2SectionsScrollTop = sectionsList.scrollTop;
    }
  }

  function restoreStep2Scroll(): void {
    const splitContent = container.querySelector<HTMLElement>('#split-content');
    const sectionsList = container.querySelector<HTMLElement>('#sections-list');
    if (splitContent) {
      splitContent.scrollTop = step2SplitScrollTop;
      splitContent.scrollLeft = step2SplitScrollLeft;
    }
    if (sectionsList) {
      sectionsList.scrollTop = step2SectionsScrollTop;
    }
  }

  function render(options?: { preserveStep2Scroll?: boolean }): void {
    const preserveStep2Scroll = options?.preserveStep2Scroll === true && step === 2;
    if (preserveStep2Scroll) {
      captureStep2Scroll();
    }

    container.innerHTML = `
      <!-- Top bar -->
      <header class="h-14 border-b border-primary/10 flex items-center justify-between px-6 bg-white dark:bg-background-dark/80 z-20">
        <div class="flex items-center gap-3">
          <button type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer rounded" id="nav-home" aria-label="Go to dashboard">
            <img src="/Icon.svg" alt="Spoqen" class="w-8 h-8 object-contain" />
          </button>
          <div>
            <h1 class="text-sm font-semibold leading-none">Import Prompt</h1>
            <span class="text-[10px] text-slate-400 uppercase tracking-wider">Step ${step} of 3</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          ${themeToggleHTML()}
          <button id="btn-cancel" class="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 rounded transition-colors">
            Cancel
          </button>
        </div>
      </header>

      <!-- Progress bar -->
      <div class="h-1 bg-slate-100 dark:bg-slate-800 relative">
        <div class="h-full bg-primary transition-all duration-500 ease-out" style="width: ${step * 33.33}%"></div>
      </div>

      <!-- Step indicators -->
      <div class="flex items-center justify-center gap-0 py-5 bg-white dark:bg-background-dark/50 border-b border-primary/5">
        ${renderStepIndicator(1, 'content_paste', 'Paste Prompt')}
        ${renderStepConnector(1)}
        ${renderStepIndicator(2, 'content_cut', 'Split Sections')}
        ${renderStepConnector(2)}
        ${renderStepIndicator(3, 'check_circle', 'Review & Create')}
      </div>

      <!-- Step content -->
      <main class="flex-1 min-h-0 overflow-auto custom-scrollbar">
        ${step === 1 ? renderStep1() : step === 2 ? renderStep2() : renderStep3()}
      </main>
    `;
    wireEvents();
    wireThemeToggle(container);

    if (preserveStep2Scroll) {
      requestAnimationFrame(() => restoreStep2Scroll());
    }
  }

  function renderStepIndicator(num: number, icon: string, label: string): string {
    const isActive = step === num;
    const isDone = step > num;
    const circleClass = isActive
      ? 'bg-primary text-white shadow-lg shadow-primary/30'
      : isDone
        ? 'bg-primary/20 text-primary'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-400';
    return `
      <div class="flex items-center gap-2.5 px-4">
        <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${circleClass}">
          ${isDone ? '<span class="material-icons text-sm">check</span>' : `<span class="material-icons text-sm">${icon}</span>`}
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-widest ${isActive ? 'text-primary font-bold' : 'text-slate-400'} leading-none">Step ${num}</div>
          <div class="text-xs font-semibold ${isActive ? 'text-slate-800 dark:text-white' : 'text-slate-400'}">${label}</div>
        </div>
      </div>
    `;
  }

  function renderStepConnector(afterStep: number): string {
    const done = step > afterStep;
    return `<div class="w-16 h-px ${done ? 'bg-primary' : 'bg-slate-200 dark:bg-slate-700'}"></div>`;
  }

  /* ── Step 1: Paste ─────────────────────────── */

  function renderStep1(): string {
    return `
      <div class="max-w-3xl mx-auto px-6 py-8 animate-in">
        <div class="text-center mb-8">
          <h2 class="text-xl font-bold text-slate-800 dark:text-white mb-2">Paste Your Existing Prompt</h2>
          <p class="text-sm text-slate-500">Choose a prompt format, then paste your prompt. We will auto-split sections from tags or headings.</p>
        </div>

        <div class="space-y-5">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Project Name</label>
              <input id="import-name" value="${esc(projectName)}" class="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-900 focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all" placeholder="My Voice Assistant Prompt" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Target Model</label>
              <select id="import-model" class="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-900 focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all">
                ${['GPT-4o', 'Claude 3.5', 'GPT-4 Turbo', 'Llama 3'].map(m =>
                  `<option ${m === projectModel ? 'selected' : ''}>${m}</option>`
                ).join('')}
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Prompt Format</label>
              <select id="import-format" class="w-full border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-900 focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all">
                <option value="markdown" ${importFormat === 'markdown' ? 'selected' : ''}>Markdown (headings)</option>
                <option value="xml" ${importFormat === 'xml' ? 'selected' : ''}>XML (section tags)</option>
              </select>
            </div>
          </div>

          <div>
            <div class="flex justify-between items-end mb-1.5">
              <label class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Prompt Text</label>
              <span id="char-count" class="text-[10px] text-slate-400">${promptText.length} chars</span>
            </div>
            <div class="relative">
              <textarea id="import-text" rows="16" class="w-full border border-slate-200 dark:border-white/10 rounded-lg px-4 py-3 text-sm font-mono leading-relaxed bg-white dark:bg-slate-900 focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all resize-none custom-scrollbar" placeholder="Paste your full system prompt here...&#10;&#10;Example:&#10;You are a helpful customer support agent.&#10;Your tone should be friendly and professional.&#10;If the user asks about billing, redirect them to...">${esc(promptText)}</textarea>
              <div class="absolute bottom-3 right-3 flex gap-2">
                <button id="btn-paste-clipboard" class="px-2.5 py-1 text-[10px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-primary/10 hover:text-primary rounded-md transition-colors flex items-center gap-1">
                  <span class="material-icons text-xs">content_paste</span> Paste
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end mt-6">
          <button id="btn-next-1" class="px-6 py-2.5 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-all shadow-sm shadow-primary/20 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed" ${promptText.trim().length === 0 ? 'disabled' : ''}>
            Continue to Split
            <span class="material-icons text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    `;
  }

  /* ── Step 2: Split sections ────────────────── */

  function renderStep2(): string {
    const formatHint = importFormat === 'xml'
      ? 'XML mode: top-level tags are auto-grouped and labeled from tag names.'
      : 'Markdown mode: heading lines are auto-grouped and labeled from heading text.';
    const autoSplitTitle = importFormat === 'xml'
      ? 'Auto-detect sections from XML-style tags'
      : 'Auto-detect sections from markdown headings and spacing';

    return `
      <div class="flex h-full min-h-0 animate-in">
        <!-- Left: Interactive text with split markers -->
        <div class="flex-1 flex flex-col border-r border-primary/10">
          <div class="px-5 py-3 bg-white dark:bg-background-dark/50 border-b border-primary/5 flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-slate-800 dark:text-white">Click Between Lines to Split</h3>
              <p class="text-[11px] text-slate-400">${formatHint} Hover between lines and click to insert a section divider. New sections default to N/A; set your own node name, type, and icon on the right.</p>
            </div>
            <div class="flex gap-2">
              <button id="btn-auto-split" class="px-3 py-1.5 text-[10px] font-semibold border border-primary/30 text-primary hover:bg-primary/5 rounded-md transition-colors flex items-center gap-1.5" title="${autoSplitTitle}">
                <span class="material-icons text-xs">auto_fix_high</span> Auto-Split
              </button>
              <button id="btn-clear-splits" class="px-3 py-1.5 text-[10px] font-semibold border border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 rounded-md transition-colors flex items-center gap-1.5">
                <span class="material-icons text-xs">clear_all</span> Clear All
              </button>
            </div>
          </div>
          <div id="split-content" class="flex-1 overflow-y-auto custom-scrollbar px-2 py-2 bg-slate-50 dark:bg-background-dark">
            ${renderSplitLines()}
          </div>
        </div>

        <!-- Right: Sections panel -->
        <div class="w-80 flex flex-col bg-white dark:bg-background-dark/50 shrink-0">
          <div class="px-4 py-3 border-b border-primary/5">
            <h3 class="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <span class="material-icons text-primary text-sm">layers</span>
              Sections
              <span class="ml-auto text-[10px] font-normal text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">${sections.length}</span>
            </h3>
          </div>
          <div id="sections-list" class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
            ${sections.length === 0
              ? `<div class="flex flex-col items-center justify-center h-full text-center px-4">
                  <span class="material-icons text-4xl text-slate-200 dark:text-slate-700 mb-3">content_cut</span>
                  <p class="text-xs text-slate-400">No sections yet</p>
                  <p class="text-[10px] text-slate-300 mt-1">Click between lines on the left to create your first section divider</p>
                </div>`
              : sections.map((sec, i) => renderSectionCard(sec, i)).join('')}
          </div>
          <div class="p-4 border-t border-primary/5 bg-slate-50 dark:bg-white/5 flex gap-2">
            <button id="btn-back-2" class="flex-1 px-4 py-2 text-xs font-medium border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-center justify-center gap-1">
              <span class="material-icons text-xs">arrow_back</span> Back
            </button>
            <button id="btn-next-2" class="flex-1 px-4 py-2 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-all shadow-sm flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed" ${sections.length === 0 ? 'disabled' : ''}>
              Review <span class="material-icons text-xs">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renderSplitLines(): string {
    // Build a set of line indices where splits occur (split AFTER this line)
    const splitAfter = new Set<number>();
    for (let i = 0; i < sections.length - 1; i++) {
      splitAfter.add(sections[i].endLine);
    }

    let html = '';
    for (let i = 0; i < lines.length; i++) {
      // Determine which section this line belongs to
      const sectionIdx = sections.findIndex(s => i >= s.startLine && i <= s.endLine);
      const color = sectionIdx >= 0 ? getColor(sectionIdx) : null;

      // Line itself
      html += `
        <div class="import-line flex items-stretch group/line" data-line="${i}" style="${color ? `background: ${color.bg};` : ''}">
          <div class="w-10 text-right pr-2 py-0.5 text-[10px] text-slate-300 dark:text-slate-600 font-mono select-none shrink-0 leading-relaxed">${i + 1}</div>
          ${color ? `<div class="w-0.5 shrink-0" style="background: ${color.border}"></div>` : '<div class="w-0.5 shrink-0"></div>'}
          <div class="flex-1 px-3 py-0.5 text-xs font-mono leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300">${esc(lines[i]) || '&nbsp;'}</div>
        </div>
      `;

      // Clickable split zone between lines
      if (i < lines.length - 1) {
        const hasSplit = splitAfter.has(i);
        html += `
          <div class="split-zone relative cursor-pointer ${hasSplit ? 'split-active' : ''}" data-after="${i}">
            <div class="split-hover-bar"></div>
            ${hasSplit ? `
              <div class="split-divider" style="border-color: ${getColor(sectionIdx >= 0 ? sectionIdx + 1 : 0).border}">
                <span class="split-divider-icon material-icons" style="color: ${getColor(sectionIdx >= 0 ? sectionIdx + 1 : 0).border}">content_cut</span>
                <span class="split-divider-label">Section break</span>
                <span class="material-icons text-red-400 hover:text-red-500 text-xs ml-1 split-remove" title="Remove split">close</span>
              </div>
            ` : ''}
          </div>
        `;
      }
    }
    return html;
  }

  function renderSectionCard(sec: Section, idx: number): string {
    const color = getColor(idx);
    const lineCount = sec.endLine - sec.startLine + 1;
    const preview = lines.slice(sec.startLine, Math.min(sec.startLine + 3, sec.endLine + 1)).join('\n');
    const hasPresetType = NODE_TYPE_OPTIONS.some(opt => opt.type === sec.type);
    const selectedType = hasPresetType ? sec.type : '__custom__';
    const customTypeValue = hasPresetType ? '' : sec.type;
    return `
      <div class="section-card rounded-lg border overflow-hidden transition-all hover:shadow-md" style="border-color: ${color.border}30" data-section-id="${sec.id}">
        <div class="px-3 py-2 flex items-center gap-2" style="background: ${color.bg}">
          <span class="material-icons text-sm" style="color: ${color.border}">${sec.icon}</span>
          <input class="section-label flex-1 text-xs font-semibold bg-transparent outline-none border-none text-slate-800 dark:text-white placeholder:text-slate-400" value="${esc(sec.label)}" placeholder="Node label (N/A by default)" data-idx="${idx}" />
          <span class="text-[9px] text-slate-400 font-mono whitespace-nowrap">${lineCount} line${lineCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="px-3 py-1.5 bg-white dark:bg-slate-900 space-y-2">
          <div class="grid grid-cols-2 gap-2">
            <div class="min-w-0">
              <div class="text-[9px] uppercase tracking-wider text-slate-400 mb-0.5">Type</div>
              <select class="section-type-select w-full text-[10px] rounded border border-slate-200 dark:border-slate-700 px-2 py-1 bg-transparent text-slate-600 dark:text-slate-300 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20" data-idx="${idx}">
                ${NODE_TYPE_OPTIONS.map(opt =>
                  `<option value="${opt.type}" ${opt.type === selectedType ? 'selected' : ''}>${opt.label}</option>`
                ).join('')}
                <option value="__custom__" ${selectedType === '__custom__' ? 'selected' : ''}>Custom…</option>
              </select>
            </div>
            <div class="min-w-0">
              <div class="text-[9px] uppercase tracking-wider text-slate-400 mb-0.5">Custom Type</div>
              <input
                class="section-type-custom w-full text-[10px] rounded border border-slate-200 dark:border-slate-700 px-2 py-1 bg-transparent text-slate-600 dark:text-slate-300 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 ${hasPresetType ? 'opacity-50 cursor-not-allowed' : ''}"
                value="${esc(customTypeValue)}"
                placeholder="my-custom-type"
                data-idx="${idx}"
                ${hasPresetType ? 'disabled' : ''}
              />
            </div>
          </div>
          <div class="min-w-0">
            <div class="text-[9px] uppercase tracking-wider text-slate-400 mb-1">Icon</div>
            <div class="grid grid-cols-7 gap-1.5">
              ${SECTION_ICON_OPTIONS.map(icon => `
                <button
                  type="button"
                  class="section-icon-option w-7 h-7 rounded border flex items-center justify-center transition-colors ${icon === sec.icon
                    ? 'bg-primary/15 border-primary/60 text-primary'
                    : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-primary hover:border-primary/40'}"
                  data-idx="${idx}"
                  data-icon="${icon}"
                  title="${icon}"
                  aria-label="Set icon to ${icon}"
                >
                  <span class="material-icons text-[15px]">${icon}</span>
                </button>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="px-3 py-1.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <pre class="text-[10px] text-slate-400 font-mono truncate leading-relaxed max-h-12 overflow-hidden">${esc(preview)}</pre>
        </div>
      </div>
    `;
  }

  /* ── Step 3: Review & Create ───────────────── */

  function renderStep3(): string {
    return `
      <div class="max-w-4xl mx-auto px-6 py-8 animate-in">
        <div class="text-center mb-8">
          <h2 class="text-xl font-bold text-slate-800 dark:text-white mb-2">Review & Create Project</h2>
          <p class="text-sm text-slate-500">Your prompt will be split into <strong class="text-primary">${sections.length} nodes</strong>, connected in order.</p>
        </div>

        <!-- Project info -->
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-primary/10 p-5 mb-6 flex items-center gap-4">
          <div class="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <span class="material-icons text-primary text-2xl">schema</span>
          </div>
          <div class="flex-1">
            <h3 class="font-bold text-slate-800 dark:text-white">${esc(projectName)}</h3>
            <p class="text-xs text-slate-400">${projectModel} · ${sections.length} sections · ${lines.length} lines</p>
          </div>
          <div class="text-right">
            <span class="text-[10px] uppercase font-bold text-primary tracking-wider">Ready to import</span>
          </div>
        </div>

        <!-- Node flow preview -->
        <div class="space-y-3 mb-8">
          ${sections.map((sec, i) => {
            const color = getColor(i);
            const content = lines.slice(sec.startLine, sec.endLine + 1).join('\n');
            const tokenEst = Math.ceil(content.length / 4);
            return `
              <div class="flex items-stretch gap-3">
                <!-- Connector -->
                <div class="flex flex-col items-center w-8 shrink-0">
                  <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style="background: ${color.border}">${i + 1}</div>
                  ${i < sections.length - 1 ? '<div class="flex-1 w-px bg-slate-200 dark:bg-slate-700 my-1"></div>' : ''}
                </div>
                <!-- Card -->
                <div class="flex-1 bg-white dark:bg-slate-900 rounded-lg border overflow-hidden" style="border-color: ${color.border}30">
                  <div class="px-4 py-2.5 flex items-center justify-between" style="background: ${color.bg}">
                    <div class="flex items-center gap-2">
                      <span class="material-icons text-sm" style="color: ${color.border}">${sec.icon}</span>
                      <span class="text-xs font-bold text-slate-800 dark:text-white">${esc(sec.label)}</span>
                    </div>
                    <div class="flex items-center gap-3 text-[10px] text-slate-400">
                      <span class="font-medium">${sec.type}</span>
                      <span class="font-mono">${tokenEst} tok</span>
                    </div>
                  </div>
                  <div class="px-4 py-2 max-h-20 overflow-hidden">
                    <pre class="text-[11px] text-slate-500 dark:text-slate-400 font-mono leading-relaxed whitespace-pre-wrap">${esc(content.substring(0, 200))}${content.length > 200 ? '…' : ''}</pre>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Actions -->
        <div class="flex justify-between">
          <button id="btn-back-3" class="px-5 py-2.5 text-sm font-medium border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-center gap-2">
            <span class="material-icons text-sm">arrow_back</span> Back to Edit
          </button>
          <button id="btn-create" class="px-8 py-2.5 text-sm font-bold bg-primary text-white rounded-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 flex items-center gap-2">
            <span class="material-icons text-sm">rocket_launch</span> Create Project
          </button>
        </div>
      </div>
    `;
  }

  /* ── Event wiring ──────────────────────────── */

  function wireEvents(): void {
    // Common
    container.querySelector('#nav-home')?.addEventListener('click', () => router.navigate('/'));
    container.querySelector('#btn-cancel')?.addEventListener('click', () => router.navigate('/'));

    if (step === 1) wireStep1();
    if (step === 2) wireStep2();
    if (step === 3) wireStep3();
  }

  function wireStep1(): void {
    const textArea = container.querySelector<HTMLTextAreaElement>('#import-text')!;
    const nameInput = container.querySelector<HTMLInputElement>('#import-name')!;
    const modelSelect = container.querySelector<HTMLSelectElement>('#import-model')!;
    const formatSelect = container.querySelector<HTMLSelectElement>('#import-format')!;
    const nextBtn = container.querySelector<HTMLButtonElement>('#btn-next-1')!;
    const charCount = container.querySelector('#char-count')!;

    textArea.addEventListener('input', () => {
      promptText = textArea.value;
      charCount.textContent = `${promptText.length} chars`;
      nextBtn.disabled = promptText.trim().length === 0;
    });

    nameInput.addEventListener('input', () => {
      projectName = nameInput.value.trim() || 'Imported Prompt';
    });

    modelSelect.addEventListener('change', () => {
      projectModel = modelSelect.value;
    });

    formatSelect.addEventListener('change', () => {
      importFormat = (formatSelect.value === 'xml' ? 'xml' : 'markdown') as EditorFormat;
    });

    container.querySelector('#btn-paste-clipboard')?.addEventListener('click', async () => {
      try {
        const text = normalizeLineEndings(await navigator.clipboard.readText());
        textArea.value = text;
        promptText = text;
        charCount.textContent = `${text.length} chars`;
        nextBtn.disabled = text.trim().length === 0;
      } catch { /* clipboard not available */ }
    });

    nextBtn.addEventListener('click', () => {
      if (promptText.trim().length === 0) return;
      promptText = normalizeLineEndings(promptText);
      lines = promptText.split('\n');

      const sourceKey = buildSectionSourceKey(promptText, importFormat);
      if (sections.length === 0 || sourceKey !== lastSectionSourceKey) {
        sections = autoExtractSections();
        lastSectionSourceKey = sourceKey;
      }

      step = 2;
      render();
    });
  }

  function wireStep2(): void {
    const splitContent = container.querySelector<HTMLElement>('#split-content')!;

    // Click on split zones to toggle splits
    splitContent.querySelectorAll<HTMLElement>('.split-zone').forEach(zone => {
      zone.addEventListener('click', (e) => {
        // If clicking the remove button inside an existing split
        if ((e.target as HTMLElement).closest('.split-remove')) {
          const afterLine = parseInt(zone.dataset.after!);
          removeSplitAfter(afterLine);
          return;
        }
        const afterLine = parseInt(zone.dataset.after!);
        if (zone.classList.contains('split-active')) {
          removeSplitAfter(afterLine);
        } else {
          addSplitAfter(afterLine);
        }
      });
    });

    // Section label editing
    container.querySelectorAll<HTMLInputElement>('.section-label').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.dataset.idx!);
        if (sections[idx]) {
          sections[idx].label = input.value;
        }
      });
    });

    // Section type preset dropdown
    container.querySelectorAll<HTMLSelectElement>('.section-type-select').forEach(select => {
      select.addEventListener('change', () => {
        const idx = parseInt(select.dataset.idx!);
        if (!sections[idx]) return;

        if (select.value === '__custom__') {
          const customInput = container.querySelector<HTMLInputElement>(`.section-type-custom[data-idx="${idx}"]`);
          const nextType = customInput?.value.trim() || sections[idx].type.trim() || DEFAULT_SECTION_TYPE;
          sections[idx].type = nextType as NodeType;
          render({ preserveStep2Scroll: true });
          requestAnimationFrame(() => {
            const refreshedCustomInput = container.querySelector<HTMLInputElement>(`.section-type-custom[data-idx="${idx}"]`);
            if (!refreshedCustomInput) return;
            refreshedCustomInput.focus();
            const caret = refreshedCustomInput.value.length;
            refreshedCustomInput.setSelectionRange(caret, caret);
          });
          return;
        }

        sections[idx].type = select.value as NodeType;
        render({ preserveStep2Scroll: true });
      });
    });

    // Section custom type text input
    container.querySelectorAll<HTMLInputElement>('.section-type-custom').forEach(input => {
      const applyCustomType = (): void => {
        const idx = parseInt(input.dataset.idx!);
        if (!sections[idx]) return;
        const typeSelect = container.querySelector<HTMLSelectElement>(`.section-type-select[data-idx="${idx}"]`);
        if (!typeSelect || typeSelect.value !== '__custom__') return;
        const normalizedType = input.value.trim() || DEFAULT_SECTION_TYPE;
        sections[idx].type = normalizedType as NodeType;
      };

      input.addEventListener('input', applyCustomType);
      input.addEventListener('blur', () => {
        applyCustomType();
        if (input.value.trim().length === 0) {
          input.value = DEFAULT_SECTION_TYPE;
        }
      });
      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });

    // Section icon selection
    container.querySelectorAll<HTMLButtonElement>('.section-icon-option').forEach(button => {
      button.addEventListener('click', () => {
        const idx = parseInt(button.dataset.idx!);
        if (!sections[idx]) return;
        const icon = normalizeIconName(button.dataset.icon ?? '') || DEFAULT_SECTION_ICON;
        sections[idx].icon = icon;
        render({ preserveStep2Scroll: true });
      });
    });

    // Auto-split
    container.querySelector('#btn-auto-split')?.addEventListener('click', () => {
      autoSplit();
      lastSectionSourceKey = buildSectionSourceKey(promptText, importFormat);
      render({ preserveStep2Scroll: true });
    });

    // Clear all splits
    container.querySelector('#btn-clear-splits')?.addEventListener('click', () => {
      sections = [createDefaultSection(0, lines.length - 1)];
      lastSectionSourceKey = buildSectionSourceKey(promptText, importFormat);
      render({ preserveStep2Scroll: true });
    });

    // Navigation
    container.querySelector('#btn-back-2')?.addEventListener('click', () => {
      step = 1;
      render();
    });

    container.querySelector('#btn-next-2')?.addEventListener('click', () => {
      if (sections.length === 0) return;
      step = 3;
      render();
    });
  }

  function wireStep3(): void {
    container.querySelector('#btn-back-3')?.addEventListener('click', () => {
      step = 2;
      render();
    });

    container.querySelector('#btn-create')?.addEventListener('click', () => {
      createProjectFromSections();
    });
  }

  /* ── Split logic ───────────────────────────── */

  function addSplitAfter(afterLine: number): void {
    // Find which section contains the split point
    const secIdx = sections.findIndex(s => afterLine >= s.startLine && afterLine < s.endLine);
    if (secIdx < 0) return; // can't split at the very last line of last section (nothing after it)

    const sec = sections[secIdx];
    const newEndForCurrent = afterLine;
    const newStartForNext = afterLine + 1;
    const newEndForNext = sec.endLine;

    // Keep current section metadata, only adjust line bounds.
    sec.endLine = newEndForCurrent;

    // Insert a new default section after the split.
    const newSec = createDefaultSection(newStartForNext, newEndForNext);
    sections.splice(secIdx + 1, 0, newSec);
    render({ preserveStep2Scroll: true });
  }

  function removeSplitAfter(afterLine: number): void {
    // Find the section that ends at afterLine
    const secIdx = sections.findIndex(s => s.endLine === afterLine);
    if (secIdx < 0 || secIdx >= sections.length - 1) return;

    // Merge this section with the next one
    const next = sections[secIdx + 1];
    sections[secIdx].endLine = next.endLine;
    sections.splice(secIdx + 1, 1);
    render({ preserveStep2Scroll: true });
  }

  function autoSplit(): void {
    sections = autoExtractSections();
  }

  /* ── Create project from sections ──────────── */

  function createProjectFromSections(): void {
    const project = store.createProject(
      projectName,
      `Imported prompt with ${sections.length} sections`,
      projectModel
    );

    // Create nodes laid out vertically
    const NODE_SPACING_X = 300;
    const NODE_START_X = 80;
    const NODE_START_Y = 80;
    const NODE_SPACING_Y = 200;
    const NODES_PER_ROW = 3;

    const createdNodes: PromptNode[] = [];

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const content = lines.slice(sec.startLine, sec.endLine + 1).join('\n');
      const row = Math.floor(i / NODES_PER_ROW);
      const col = i % NODES_PER_ROW;
      const normalizedType = (sec.type.trim() || DEFAULT_SECTION_TYPE) as NodeType;
      const normalizedLabel = sec.label.trim() || DEFAULT_SECTION_LABEL;
      const normalizedIcon = normalizeIconName(sec.icon) || DEFAULT_SECTION_ICON;

      const node: PromptNode = {
        id: uid(),
        type: normalizedType,
        label: normalizedLabel,
        icon: normalizedIcon,
        x: NODE_START_X + col * NODE_SPACING_X,
        y: NODE_START_Y + row * NODE_SPACING_Y,
        content,
        meta: {},
      };

      store.addNode(project.id, node);
      createdNodes.push(node);
    }

    // Connect nodes sequentially
    for (let i = 0; i < createdNodes.length - 1; i++) {
      store.addConnection(project.id, createdNodes[i].id, createdNodes[i + 1].id);
    }

    // Navigate to the new project canvas
    router.navigate(`/project/${project.id}`);
  }

  // Initial render
  render();
}
