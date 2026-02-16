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
import { BLOCK_PALETTE, PromptNode, NodeType, uid } from '../models';
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

/* ── Palette options for the type picker ─────── */

const NODE_TYPE_OPTIONS = BLOCK_PALETTE.map(b => ({
  type: b.type,
  label: b.label,
  icon: b.icon,
}));

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

/* ── Guess a node type from content ───────────── */

function guessNodeType(text: string): { type: NodeType; label: string; icon: string } {
  const lower = text.toLowerCase();
  if (/persona|identity|role|you are/i.test(lower))
    return { type: 'core-persona', label: 'Core Persona', icon: 'psychology' };
  if (/mission|objective|goal|purpose|task/i.test(lower))
    return { type: 'mission-objective', label: 'Mission Objective', icon: 'flag' };
  if (/tone|voice|style|manner/i.test(lower))
    return { type: 'tone-guidelines', label: 'Tone Guidelines', icon: 'record_voice_over' };
  if (/language|respond in|translate/i.test(lower))
    return { type: 'language-model', label: 'Language Model', icon: 'translate' };
  if (/if |branch|condition|when/i.test(lower))
    return { type: 'logic-branch', label: 'Logic Branch', icon: 'alt_route' };
  if (/context|background|information|knowledge/i.test(lower))
    return { type: 'static-context', label: 'Static Context', icon: 'article' };
  if (/memory|history|conversation/i.test(lower))
    return { type: 'memory-buffer', label: 'Memory Buffer', icon: 'history' };
  if (/end|terminate|goodbye|closing/i.test(lower))
    return { type: 'termination', label: 'Termination Node', icon: 'call_end' };
  return { type: 'custom', label: 'Custom Section', icon: 'widgets' };
}

/* ── Main render ─────────────────────────────── */

export function renderImport(container: HTMLElement): void {
  let step = 1;
  let promptText = '';
  let projectName = 'Imported Prompt';
  let projectModel = 'GPT-4o';
  let lines: string[] = [];
  let sections: Section[] = [];

  function render(): void {
    container.innerHTML = `
      <!-- Top bar -->
      <header class="h-14 border-b border-primary/10 flex items-center justify-between px-6 bg-white dark:bg-background-dark/80 z-20">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-primary rounded flex items-center justify-center cursor-pointer" id="nav-home">
            <span class="material-icons text-white text-xl">architecture</span>
          </div>
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
      <main class="flex-1 overflow-hidden">
        ${step === 1 ? renderStep1() : step === 2 ? renderStep2() : renderStep3()}
      </main>
    `;
    wireEvents();
    wireThemeToggle(container);
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
          <p class="text-sm text-slate-500">Paste the full prompt text below. In the next step you'll split it into sections.</p>
        </div>

        <div class="space-y-5">
          <div class="grid grid-cols-2 gap-4">
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
    return `
      <div class="flex h-[calc(100vh-10rem)] animate-in">
        <!-- Left: Interactive text with split markers -->
        <div class="flex-1 flex flex-col border-r border-primary/10">
          <div class="px-5 py-3 bg-white dark:bg-background-dark/50 border-b border-primary/5 flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-slate-800 dark:text-white">Click Between Lines to Split</h3>
              <p class="text-[11px] text-slate-400">Hover between lines and click to insert a section divider. Click a divider again to remove it.</p>
            </div>
            <div class="flex gap-2">
              <button id="btn-auto-split" class="px-3 py-1.5 text-[10px] font-semibold border border-primary/30 text-primary hover:bg-primary/5 rounded-md transition-colors flex items-center gap-1.5" title="Auto-detect sections by blank lines and headings">
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
    return `
      <div class="section-card rounded-lg border overflow-hidden transition-all hover:shadow-md" style="border-color: ${color.border}30" data-section-id="${sec.id}">
        <div class="px-3 py-2 flex items-center gap-2" style="background: ${color.bg}">
          <span class="material-icons text-sm" style="color: ${color.border}">${sec.icon}</span>
          <input class="section-label flex-1 text-xs font-semibold bg-transparent outline-none border-none text-slate-800 dark:text-white placeholder:text-slate-400" value="${esc(sec.label)}" placeholder="Section name..." data-idx="${idx}" />
          <span class="text-[9px] text-slate-400 font-mono whitespace-nowrap">${lineCount} line${lineCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="px-3 py-1.5 bg-white dark:bg-slate-900">
          <select class="section-type w-full text-[10px] bg-transparent text-slate-500 outline-none border-none cursor-pointer" data-idx="${idx}">
            ${NODE_TYPE_OPTIONS.map(opt =>
              `<option value="${opt.type}" ${opt.type === sec.type ? 'selected' : ''}>${opt.label}</option>`
            ).join('')}
          </select>
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
                      <span class="uppercase font-medium">${sec.type}</span>
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

    container.querySelector('#btn-paste-clipboard')?.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        textArea.value = text;
        promptText = text;
        charCount.textContent = `${text.length} chars`;
        nextBtn.disabled = text.trim().length === 0;
      } catch { /* clipboard not available */ }
    });

    nextBtn.addEventListener('click', () => {
      if (promptText.trim().length === 0) return;
      lines = promptText.split('\n');
      // Initialize with a single section covering everything
      if (sections.length === 0) {
        const guess = guessNodeType(promptText);
        sections = [{
          id: uid(),
          label: guess.label,
          type: guess.type,
          icon: guess.icon,
          startLine: 0,
          endLine: lines.length - 1,
        }];
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

    // Section type change
    container.querySelectorAll<HTMLSelectElement>('.section-type').forEach(select => {
      select.addEventListener('change', () => {
        const idx = parseInt(select.dataset.idx!);
        if (sections[idx]) {
          const opt = NODE_TYPE_OPTIONS.find(o => o.type === select.value);
          if (opt) {
            sections[idx].type = opt.type;
            sections[idx].icon = opt.icon;
          }
        }
        // Re-render to update icons
        render();
      });
    });

    // Auto-split
    container.querySelector('#btn-auto-split')?.addEventListener('click', () => {
      autoSplit();
      render();
    });

    // Clear all splits
    container.querySelector('#btn-clear-splits')?.addEventListener('click', () => {
      const guess = guessNodeType(promptText);
      sections = [{
        id: uid(),
        label: guess.label,
        type: guess.type,
        icon: guess.icon,
        startLine: 0,
        endLine: lines.length - 1,
      }];
      render();
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

    // Guess types for both halves
    const topContent = lines.slice(sec.startLine, newEndForCurrent + 1).join('\n');
    const bottomContent = lines.slice(newStartForNext, newEndForNext + 1).join('\n');
    const topGuess = guessNodeType(topContent);
    const bottomGuess = guessNodeType(bottomContent);

    // Update current section
    sec.endLine = newEndForCurrent;
    // Keep current label if user already set it, otherwise update guess
    if (sec.label === 'Custom Section' || sec.label === guessNodeType(promptText).label) {
      sec.label = topGuess.label;
      sec.type = topGuess.type;
      sec.icon = topGuess.icon;
    }

    // Insert new section after
    const newSec: Section = {
      id: uid(),
      label: bottomGuess.label,
      type: bottomGuess.type,
      icon: bottomGuess.icon,
      startLine: newStartForNext,
      endLine: newEndForNext,
    };
    sections.splice(secIdx + 1, 0, newSec);
    render();
  }

  function removeSplitAfter(afterLine: number): void {
    // Find the section that ends at afterLine
    const secIdx = sections.findIndex(s => s.endLine === afterLine);
    if (secIdx < 0 || secIdx >= sections.length - 1) return;

    // Merge this section with the next one
    const next = sections[secIdx + 1];
    sections[secIdx].endLine = next.endLine;
    sections.splice(secIdx + 1, 1);
    render();
  }

  function autoSplit(): void {
    // Auto-detect sections based on blank lines, markdown headings, and ## markers
    sections = [];
    let currentStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isBlankLine = line === '';
      const isHeading = /^#{1,3}\s/.test(line);

      // Split before headings (if not at start) or after double blank lines
      if (i > currentStart && (isHeading || (isBlankLine && i + 1 < lines.length && lines[i + 1].trim() === ''))) {
        // Close previous section (trim trailing blanks)
        let endLine = i - 1;
        while (endLine > currentStart && lines[endLine].trim() === '') endLine--;

        if (endLine >= currentStart) {
          const content = lines.slice(currentStart, endLine + 1).join('\n');
          const guess = guessNodeType(content);
          // Try to use the heading text as label
          const firstLine = lines[currentStart].trim();
          const headingMatch = firstLine.match(/^#{1,3}\s+(.+)/);
          sections.push({
            id: uid(),
            label: headingMatch ? headingMatch[1] : guess.label,
            type: guess.type,
            icon: guess.icon,
            startLine: currentStart,
            endLine,
          });
        }

        // Skip blank lines for next section start
        let nextStart = i;
        while (nextStart < lines.length && lines[nextStart].trim() === '') nextStart++;
        currentStart = nextStart;
        i = nextStart - 1; // will be incremented by for loop
      }
    }

    // Close final section
    if (currentStart < lines.length) {
      let endLine = lines.length - 1;
      while (endLine > currentStart && lines[endLine].trim() === '') endLine--;
      if (endLine >= currentStart) {
        const content = lines.slice(currentStart, endLine + 1).join('\n');
        const guess = guessNodeType(content);
        const firstLine = lines[currentStart].trim();
        const headingMatch = firstLine.match(/^#{1,3}\s+(.+)/);
        sections.push({
          id: uid(),
          label: headingMatch ? headingMatch[1] : guess.label,
          type: guess.type,
          icon: guess.icon,
          startLine: currentStart,
          endLine,
        });
      }
    }

    // If auto-split produced only 1 or 0 sections, fall back to single section
    if (sections.length <= 1) {
      const guess = guessNodeType(promptText);
      sections = [{
        id: uid(),
        label: guess.label,
        type: guess.type,
        icon: guess.icon,
        startLine: 0,
        endLine: lines.length - 1,
      }];
    }
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

      const node: PromptNode = {
        id: uid(),
        type: sec.type,
        label: sec.label,
        icon: sec.icon,
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
