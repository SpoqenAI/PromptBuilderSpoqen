/**
 * Miro-style flowchart template with industry-standard shapes:
 * - Ovals for start/end nodes
 * - Rectangles for process/action nodes
 * - Diamonds for decision/branch nodes
 */

import type { TranscriptFlowResult, TranscriptFlowNode } from '../../transcript-flow';
import { themeToggleHTML } from '../../theme';
import { GENERATING_THOUGHT_STEP_SECONDS } from './constants';
import { esc, messageClass, renderModelOptions, shortId } from './format';
import { defaultNodeSize, nodeSize, edgeGeometry } from './layout';
import type {
  FlowRenderState,
  MessageTone,
  TranscriptFile,
  WorkspaceSaveStatus,
} from './types';

// ---------------------------------------------------------------------------
// Shell Model
// ---------------------------------------------------------------------------

interface TranscriptImportShellModel {
  baseUrl: string;
  projectName: string;
  projectModel: string;
  linkedProjectId: string | null;
  assistantName: string;
  userName: string;
  transcripts: TranscriptFile[];
  generationError: string;
  validationWarnings: string[];
  persistenceMessage: { tone: MessageTone; text: string } | null;
  generatedPromptMarkdown: string;
  promptGenerationMessage: { tone: MessageTone; text: string } | null;
  isGeneratingPrompt: boolean;
  canGenerate: boolean;
  isGenerating: boolean;
  isHydratingWorkspace: boolean;
  generatedFlow: TranscriptFlowResult | null;
  transcriptSetId: string | null;
  workspaceSaveStatus: WorkspaceSaveStatus;
  workspaceSaveMessage: string | null;
  workspaceSavedAt: string | null;
  generatingThoughts: string[];
  flowRenderState: FlowRenderState | null;
  inputSectionCollapsed: boolean;
  nodesSectionCollapsed: boolean;
  nodeSearchQuery: string;
  selectedConnectionIndex: number | null;
}

// ---------------------------------------------------------------------------
// Main Shell
// ---------------------------------------------------------------------------

export function renderTranscriptImportShell(model: TranscriptImportShellModel): string {
  const {
    baseUrl,
    projectName,
    projectModel,
    linkedProjectId,
    assistantName,
    userName,
    transcripts,
    generationError,
    validationWarnings,
    persistenceMessage,
    generatedPromptMarkdown,
    promptGenerationMessage,
    isGeneratingPrompt,
    canGenerate,
    isGenerating,
    isHydratingWorkspace,
    generatedFlow,
    transcriptSetId,
    workspaceSaveStatus,
    workspaceSaveMessage,
    workspaceSavedAt,
    generatingThoughts,
    flowRenderState,
    inputSectionCollapsed,
    nodesSectionCollapsed,
    nodeSearchQuery,
    selectedConnectionIndex,
  } = model;

  return `
    <header class="ui-header z-20">
      <div class="ui-header-left">
        <button type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer rounded" id="nav-home" aria-label="Go to dashboard">
          <img src="${baseUrl}Icon.svg" alt="Spoqen" class="w-8 h-8 object-contain" />
        </button>
        <div class="min-w-0">
          <h1 class="text-sm font-semibold leading-none">Flow Builder (AI Agent)</h1>
          <span class="text-[10px] text-slate-400 uppercase tracking-wider">Gemini-powered flowchart generator</span>
        </div>
      </div>
      <div class="ui-header-center"></div>
      <div class="ui-header-right ui-toolbar">
        ${generatedFlow
    ? `
          <button id="btn-regenerate-flow" type="button" class="ui-btn ui-btn-outline">
            <span class="material-icons text-sm">refresh</span> Regenerate
          </button>
          ${linkedProjectId
      ? `
          <button id="btn-open-linked-project" type="button" class="ui-btn ui-btn-outline" title="Open linked prompt canvas">
            <span class="material-icons text-sm">open_in_new</span> Open in Canvas
          </button>
        `
      : `
          <button id="btn-create-flow-project" type="button" class="ui-btn ui-btn-outline" title="Link this flow to a canvas project">
            <span class="material-icons text-sm">link</span> Link Canvas Project
          </button>
        `}
          <button id="btn-generate-prompt-from-flow" type="button" class="ui-btn ui-btn-outline" ${isGeneratingPrompt ? 'disabled' : ''}>
            <span class="material-icons text-sm">auto_fix_high</span> ${isGeneratingPrompt ? 'Generating...' : 'Generate Prompt'}
          </button>
        `
    : ''}
        ${themeToggleHTML()}
        <button id="btn-back" class="ui-btn ui-btn-ghost">Back</button>
      </div>
    </header>

    <main class="ui-main ui-stack-lg">
      <aside class="ui-sidebar border-r border-primary/10 bg-white dark:bg-background-dark/50 z-10">
        <div class="ui-scroll p-4 space-y-3 custom-scrollbar" data-scroll-preserve="transcript-import-sidebar">
          ${renderInputSection({
    projectName, projectModel, assistantName, userName, transcripts,
    generationError, validationWarnings, persistenceMessage,
    generatedPromptMarkdown, promptGenerationMessage,
    canGenerate, isGenerating, isHydratingWorkspace, generatedFlow,
    transcriptSetId, workspaceSaveStatus, workspaceSaveMessage, workspaceSavedAt,
    inputSectionCollapsed,
  })}
          ${renderNodePaletteSection({ nodesSectionCollapsed, nodeSearchQuery })}
        </div>
        <div class="p-4 border-t border-primary/5 bg-slate-50 dark:bg-white/5">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full ${generatedFlow ? 'bg-primary animate-pulse' : 'bg-slate-300'}"></div>
            <span class="text-[10px] font-medium text-slate-500 uppercase">${generatedFlow ? `${generatedFlow.nodes.length} Nodes &middot; ${generatedFlow.connections.length} Connections` : 'No flow generated'}</span>
          </div>
        </div>
      </aside>

      <div class="ui-pane flex-1 relative overflow-hidden bg-background-light dark:bg-background-dark canvas-grid">
        ${generatedFlow
    ? renderFlowCanvas(generatedFlow, isGenerating, flowRenderState as FlowRenderState, selectedConnectionIndex)
    : renderEmptyCanvas(isGenerating, generatingThoughts)}
        ${isGenerating && generatedFlow ? renderGeneratingOverlay(generatingThoughts) : ''}
      </div>
    </main>
  `;
}

// ---------------------------------------------------------------------------
// Sidebar Sections
// ---------------------------------------------------------------------------

function renderInputSection(params: {
  projectName: string;
  projectModel: string;
  assistantName: string;
  userName: string;
  transcripts: TranscriptFile[];
  generationError: string;
  validationWarnings: string[];
  persistenceMessage: { tone: MessageTone; text: string } | null;
  generatedPromptMarkdown: string;
  promptGenerationMessage: { tone: MessageTone; text: string } | null;
  canGenerate: boolean;
  isGenerating: boolean;
  isHydratingWorkspace: boolean;
  generatedFlow: TranscriptFlowResult | null;
  transcriptSetId: string | null;
  workspaceSaveStatus: WorkspaceSaveStatus;
  workspaceSaveMessage: string | null;
  workspaceSavedAt: string | null;
  inputSectionCollapsed: boolean;
}): string {
  const { inputSectionCollapsed } = params;

  return `
    <section class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/40">
      <button id="btn-toggle-input-section" type="button" class="w-full px-3 py-2.5 flex items-center justify-between text-left" aria-expanded="${inputSectionCollapsed ? 'false' : 'true'}">
        <span class="text-[11px] font-bold tracking-wider uppercase text-slate-500">Input Transcript</span>
        <span class="material-icons text-sm text-slate-400 transition-transform ${inputSectionCollapsed ? '-rotate-90' : ''}">expand_more</span>
      </button>
      <div class="${inputSectionCollapsed ? 'hidden' : ''} px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-800 space-y-3">
        <p class="text-xs text-slate-500 dark:text-slate-400">Upload or paste transcripts, then generate the flow. The AI agent will build the diagram step by step.</p>
        <div>
          <label for="transcript-project-name" class="block text-xs font-medium text-slate-500 mb-1">Project name</label>
          <input id="transcript-project-name" value="${esc(params.projectName)}" class="ui-input" />
        </div>
        <div>
          <label for="transcript-project-model" class="block text-xs font-medium text-slate-500 mb-1">Target model</label>
          <select id="transcript-project-model" class="ui-select">${renderModelOptions(params.projectModel)}</select>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label for="transcript-assistant-name" class="block text-xs font-medium text-slate-500 mb-1">Assistant label</label>
            <input id="transcript-assistant-name" value="${esc(params.assistantName)}" class="ui-input" placeholder="Assistant" />
          </div>
          <div>
            <label for="transcript-user-name" class="block text-xs font-medium text-slate-500 mb-1">User label</label>
            <input id="transcript-user-name" value="${esc(params.userName)}" class="ui-input" placeholder="User" />
          </div>
        </div>
        <div>
          <div class="flex items-center justify-between gap-2 mb-1">
            <label class="text-xs font-medium text-slate-500">Transcript Corpus</label>
            <span id="transcript-corpus-count" class="text-[11px] text-slate-400">${params.transcripts.length} files</span>
          </div>
          <div id="transcript-drop-zone" class="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-4 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer">
            <div class="flex flex-col items-center gap-2 pointer-events-none">
              <span class="material-icons text-slate-400">cloud_upload</span>
              <p class="text-[11px] text-slate-500">Drag &amp; drop files here, or <span class="text-primary cursor-pointer hover:underline pointer-events-auto" id="btn-upload-transcript">browse</span></p>
              <p class="text-[9px] text-slate-400">Supports .txt, .srt, .vtt, .csv (up to 100 files)</p>
            </div>
            <input id="transcript-file" type="file" multiple accept=".txt,.md,.log,.json,.csv,.srt,.vtt" class="hidden" />
          </div>
          ${params.transcripts.length > 0 ? renderTranscriptList(params.transcripts) : ''}
        </div>
        ${params.generationError ? `<p id="transcript-generate-error" class="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-200">${esc(params.generationError)}</p>` : ''}
        ${params.validationWarnings.length > 0 ? `<div class="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-200 space-y-1"><p class="font-semibold">Validation warnings:</p><ul class="list-disc pl-4 space-y-0.5">${params.validationWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${params.persistenceMessage ? `<p class="rounded-lg border px-3 py-2 text-xs ${messageClass(params.persistenceMessage.tone)}">${esc(params.persistenceMessage.text)}</p>` : ''}
        ${params.promptGenerationMessage ? `<p class="rounded-lg border px-3 py-2 text-xs ${messageClass(params.promptGenerationMessage.tone)}">${esc(params.promptGenerationMessage.text)}</p>` : ''}
        ${renderWorkspaceSaveStatus(params)}
        <div class="flex flex-wrap gap-2 pt-1">
          ${params.isGenerating
    ? `<button id="btn-generate-flow" class="flex-1 ui-btn ui-btn-primary !text-sm !py-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled>
              <span class="material-icons text-sm animate-spin">autorenew</span> Agent Building...
            </button>`
    : params.generatedFlow
      ? `<button class="flex-1 ui-btn !text-sm !py-2 border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 cursor-default" disabled>
              <span class="material-icons text-sm">check_circle</span> Flow Generated
            </button>`
      : `<button id="btn-generate-flow" class="flex-1 ui-btn ui-btn-primary !text-sm !py-2 disabled:opacity-50 disabled:cursor-not-allowed" ${params.canGenerate ? '' : 'disabled'}>
              <span class="material-icons text-sm">auto_awesome</span> Generate Flow
            </button>`}
          <button id="btn-clear-transcript" type="button" class="ui-btn ui-btn-ghost !text-sm !py-2">Clear</button>
        </div>
        ${params.generatedPromptMarkdown ? renderPromptSection(params.generatedPromptMarkdown) : ''}
      </div>
    </section>
  `;
}

function renderTranscriptList(transcripts: TranscriptFile[]): string {
  return `
    <div class="mt-3 max-h-48 overflow-y-auto custom-scrollbar space-y-1 pr-1" id="transcript-list">
      ${transcripts.map((t) => `
        <div class="flex items-center justify-between gap-2 p-2 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate" title="${esc(t.name)}">${esc(t.name)}</p>
            <p class="text-[9px] text-slate-400">${(t.content.length / 1024).toFixed(1)} KB</p>
          </div>
          <button type="button" class="text-slate-400 hover:text-red-500 transition-colors p-1" data-remove-transcript="${esc(t.id)}">
            <span class="material-icons text-[14px]">close</span>
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPromptSection(markdown: string): string {
  return `
    <section class="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Generated Prompt</h3>
        <button id="btn-copy-generated-prompt" type="button" class="ui-btn ui-btn-ghost !text-[11px] !px-2 !py-1.5">Copy</button>
      </div>
      <textarea readonly class="ui-input min-h-40 font-mono text-[11px] leading-relaxed resize-y">${esc(markdown)}</textarea>
    </section>
  `;
}

function renderNodePaletteSection(params: { nodesSectionCollapsed: boolean; nodeSearchQuery: string }): string {
  const shapes = [
    { type: 'start', label: 'Start', icon: '⬮', desc: 'Oval — entry point' },
    { type: 'end', label: 'End', icon: '⬮', desc: 'Oval — exit point' },
    { type: 'process', label: 'Process', icon: '▬', desc: 'Rectangle — action step' },
    { type: 'decision', label: 'Decision', icon: '◇', desc: 'Diamond — branch point' },
  ];

  return `
    <section class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/40">
      <button id="btn-toggle-nodes-section" type="button" class="w-full px-3 py-2.5 flex items-center justify-between text-left" aria-expanded="${params.nodesSectionCollapsed ? 'false' : 'true'}">
        <span class="text-[11px] font-bold tracking-wider uppercase text-slate-500">Shapes</span>
        <span class="material-icons text-sm text-slate-400 transition-transform ${params.nodesSectionCollapsed ? '-rotate-90' : ''}">expand_more</span>
      </button>
      <div class="${params.nodesSectionCollapsed ? 'hidden' : ''} px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <p class="text-xs text-slate-500 dark:text-slate-400">Click or drag shapes onto the canvas. Drag between ports to connect.</p>
        <div class="space-y-1">
          ${shapes.map((s) => `
            <div class="transcript-node-block sidebar-block group flex items-center gap-3 p-2.5 rounded-lg border border-transparent hover:border-primary/20 hover:bg-slate-100 dark:hover:bg-white/5 cursor-grab transition-colors"
              draggable="true"
              data-flow-block-type="${s.type}"
              data-flow-block-label="${s.label}"
              data-flow-block-icon=""
              data-flow-block-default="">
              <span class="text-lg w-6 text-center ${s.type === 'start' ? 'text-emerald-500' : s.type === 'end' ? 'text-red-500' : s.type === 'decision' ? 'text-amber-500' : 'text-slate-600 dark:text-slate-300'}">${s.icon}</span>
              <div>
                <span class="text-xs font-semibold text-slate-700 dark:text-slate-200">${s.label}</span>
                <span class="text-[10px] text-slate-400 ml-1">${s.desc}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderWorkspaceSaveStatus(params: {
  transcriptSetId: string | null;
  workspaceSaveStatus: WorkspaceSaveStatus;
  workspaceSaveMessage: string | null;
  workspaceSavedAt: string | null;
  isHydratingWorkspace: boolean;
}): string {
  if (params.isHydratingWorkspace) {
    return `<p class="rounded-lg border px-3 py-2 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200">Loading workspace...</p>`;
  }
  if (!params.transcriptSetId) {
    return '<p class="rounded-lg border px-3 py-2 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200">Generate a flow to create and auto-save a workspace.</p>';
  }
  if (params.workspaceSaveStatus === 'saving') {
    return '<p class="rounded-lg border px-3 py-2 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200">Saving...</p>';
  }
  if (params.workspaceSaveStatus === 'error') {
    return `<p class="rounded-lg border px-3 py-2 text-xs border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-200">${esc(params.workspaceSaveMessage ?? 'Save failed.')}</p>`;
  }
  if (params.workspaceSaveStatus === 'saved' && params.workspaceSavedAt) {
    const savedAt = new Date(params.workspaceSavedAt);
    const formatted = Number.isNaN(savedAt.getTime()) ? params.workspaceSavedAt : savedAt.toLocaleString();
    return `<p class="rounded-lg border px-3 py-2 text-xs border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-200">Saved at ${esc(formatted)}.</p>`;
  }
  return '<p class="rounded-lg border px-3 py-2 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200">Workspace ready.</p>';
}

// ---------------------------------------------------------------------------
// Canvas Rendering
// ---------------------------------------------------------------------------

export function renderEmptyCanvas(isGenerating: boolean, generatingThoughts: string[]): string {
  const icon = isGenerating ? 'auto_awesome' : 'account_tree';
  const title = isGenerating ? 'Agent Building Flow...' : 'Flow Builder';
  const body = isGenerating
    ? 'The AI agent is reading the transcript and building your flowchart step by step.'
    : 'Upload transcripts and click Generate to start. The AI agent will build the diagram iteratively.';

  return `
    <div class="flex flex-col items-center justify-center h-full">
      <div class="relative group">
        <div class="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity"></div>
        <div class="relative w-52 bg-white dark:bg-slate-900 border-2 border-primary rounded-xl p-5 shadow-xl flex flex-col items-center gap-3">
          <div class="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <span class="material-icons text-primary text-2xl ${isGenerating ? 'animate-pulse' : ''}">${icon}</span>
          </div>
          <div class="text-center">
            <h2 class="text-sm font-bold">${title}</h2>
            <p class="text-[10px] text-slate-400 mt-1">${body}</p>
            ${isGenerating ? `
              <div class="mt-3 flex justify-center">
                <span class="relative inline-flex h-14 w-14 items-center justify-center">
                  <span class="absolute inset-0 rounded-full border-2 border-primary/25"></span>
                  <span class="absolute inset-1 rounded-full border-2 border-primary border-t-transparent animate-spin"></span>
                  <span class="absolute h-2.5 w-2.5 rounded-full bg-primary/80 animate-pulse"></span>
                </span>
              </div>
              ${renderThinkingMessages(generatingThoughts)}
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderFlowCanvas(
  flow: TranscriptFlowResult,
  isGenerating: boolean,
  flowRenderState: FlowRenderState,
  selectedConnectionIndex: number | null,
): string {
  const { layout, nodeSizes, geometry } = flowRenderState;

  // Render edges
  const edges = flow.connections
    .map((conn, index) => {
      const from = layout[conn.from];
      const to = layout[conn.to];
      if (!from || !to) return '';

      const fromSz = nodeSizes[conn.from] ?? defaultNodeSize();
      const toSz = nodeSizes[conn.to] ?? defaultNodeSize();
      const geo = edgeGeometry(from, fromSz, to, toSz);
      const isSelected = selectedConnectionIndex === index;
      const label = (conn.label ?? '').trim();

      // Compute midpoint for label
      const midX = (geo.fromX + geo.toX) / 2;
      const midY = (geo.fromY + geo.toY) / 2;

      return `
        <g data-flow-edge="${index}" data-from-id="${esc(conn.from)}" data-to-id="${esc(conn.to)}">
          <defs>
            <marker id="arrowhead-${index}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
            </marker>
          </defs>
          <path
            data-flow-edge-path="1"
            data-flow-edge-index="${index}"
            d="${geo.curve}"
            stroke="${isSelected ? '#0f766e' : '#94a3b8'}"
            stroke-width="${isSelected ? 3 : 2}"
            fill="none"
            marker-end="url(#arrowhead-${index})"
            style="pointer-events:none"
          />
          <path
            data-flow-edge-hit-index="${index}"
            d="${geo.curve}"
            stroke="transparent"
            stroke-width="16"
            fill="none"
            class="cursor-pointer"
          />
          ${label ? `
            <rect x="${midX - measureLabelWidth(label) / 2 - 6}" y="${midY - 12}" width="${measureLabelWidth(label) + 12}" height="20" rx="4"
              fill="white" class="dark:fill-slate-900" stroke="${isSelected ? '#0f766e' : '#cbd5e1'}" stroke-width="1" />
            <text x="${midX}" y="${midY + 2}" text-anchor="middle"
              class="flow-edge-label" style="font-size:13px; font-weight:700; fill:${isSelected ? '#0f766e' : '#334155'}">
              ${esc(label)}
            </text>
          ` : ''}
        </g>
      `;
    })
    .join('');

  // Render nodes
  const nodes = flow.nodes.map((node) => renderFlowNode(node, layout, nodeSizes)).join('');

  const infoBar = `
    <div class="absolute top-4 left-4 right-4 sm:right-auto sm:max-w-[min(90vw,60rem)] flex items-center gap-2 overflow-x-auto whitespace-nowrap custom-scrollbar text-xs font-medium text-slate-400 bg-white/90 dark:bg-background-dark/90 px-3 py-1.5 rounded-full border border-primary/10 shadow-sm z-10 backdrop-blur-sm">
      <span class="text-slate-800 dark:text-slate-200">${esc(flow.title)}</span>
      <span class="text-[10px]">|</span>
      <span>${esc(flow.model)}</span>
      <span class="text-[10px]">&middot;</span>
      <span>${flow.nodes.length} nodes</span>
      <span class="text-[10px]">&middot;</span>
      <span>${flow.connections.length} edges</span>
      <span class="text-[10px]">&middot;</span>
      <span>${flow.iterations} iterations</span>
      ${selectedConnectionIndex !== null ? '<span class="text-[10px]">|</span><span class="text-cyan-700 dark:text-cyan-300">edge selected</span>' : ''}
      ${isGenerating ? '<span class="text-[10px]">|</span><span class="inline-flex items-center gap-1 text-primary"><span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>building</span>' : ''}
    </div>
  `;

  const warningBanner = flow.warning
    ? `<div class="absolute bottom-4 left-4 right-4 sm:right-auto sm:max-w-[min(90vw,36rem)] rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-200 z-10">${esc(flow.warning)}</div>`
    : '';

  return `
    ${infoBar}
    ${warningBanner}
    <div id="flow-viewport" class="absolute inset-0 overflow-hidden">
      <div id="flow-world" style="transform-origin:0 0; position:absolute; width:${geometry.width}px; height:${geometry.height}px; overflow:visible;">
        <svg id="flow-connections-svg" class="absolute inset-0 pointer-events-auto z-[1] flow-connections-layer" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          ${edges}
        </svg>
        <div class="absolute inset-0 z-[2] pointer-events-none">
          ${nodes}
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Node Shape Rendering
// ---------------------------------------------------------------------------

function renderFlowNode(
  node: TranscriptFlowNode,
  layout: Record<string, { x: number; y: number }>,
  nodeSizes: Record<string, { width: number; height: number }>,
): string {
  const pos = layout[node.id] ?? { x: 80, y: 80 };
  const size = nodeSizes[node.id] ?? defaultNodeSize();
  const label = node.label.trim() || `Node ${shortId(node.id)}`;

  switch (node.type) {
    case 'start':
    case 'end':
      return renderOvalNode(node, pos, size, label);
    case 'decision':
      return renderDiamondNode(node, pos, size, label);
    case 'process':
    default:
      return renderRectangleNode(node, pos, size, label);
  }
}

function renderOvalNode(
  node: TranscriptFlowNode,
  pos: { x: number; y: number },
  size: { width: number; height: number },
  label: string,
): string {
  const isStart = node.type === 'start';
  const borderColor = isStart ? '#10b981' : '#ef4444';
  const bgColor = isStart ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-red-50 dark:bg-red-950/30';
  const textColor = isStart ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-800 dark:text-red-200';

  return `
    <div class="canvas-node pointer-events-auto ${bgColor} border-2 shadow-lg cursor-pointer flex items-center justify-center select-none"
         data-flow-node-id="${esc(node.id)}"
         style="left:${pos.x}px; top:${pos.y}px; width:${size.width}px; height:${size.height}px; border-color:${borderColor}; border-radius:50%;">
      <div class="node-header flex items-center justify-center w-full h-full cursor-move" style="border-radius:50%;">
        <span class="text-sm font-bold ${textColor} text-center px-2 leading-tight">${esc(label)}</span>
      </div>
      <button type="button" class="node-delete absolute -top-1.5 -right-1.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-400 hover:text-red-500 hover:border-red-300 transition-colors opacity-0 group-hover:opacity-100"
        data-flow-node-delete="${esc(node.id)}" title="Delete node">
        <span class="material-icons text-[12px]">close</span>
      </button>
      <div class="absolute left-1/2 -translate-x-1/2 -top-[5px]">
        <div class="port port-in" data-port-node-id="${esc(node.id)}" data-port-type="in" title="Input"></div>
      </div>
      <div class="absolute left-1/2 -translate-x-1/2 -bottom-[5px]">
        <div class="port port-out" data-port-node-id="${esc(node.id)}" data-port-type="out" title="Output"></div>
      </div>
    </div>
  `;
}

function renderDiamondNode(
  node: TranscriptFlowNode,
  pos: { x: number; y: number },
  size: { width: number; height: number },
  label: string,
): string {
  return `
    <div class="canvas-node pointer-events-auto cursor-pointer select-none group"
         data-flow-node-id="${esc(node.id)}"
         style="left:${pos.x}px; top:${pos.y}px; width:${size.width}px; height:${size.height}px;">
      <div class="node-header relative w-full h-full flex items-center justify-center cursor-move">
        <div class="absolute inset-0 bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 shadow-lg"
             style="transform: rotate(45deg); border-radius: 6px; width: 70%; height: 70%; margin: auto; position: absolute; top: 0; bottom: 0; left: 0; right: 0;"></div>
        <span class="relative z-10 text-xs font-bold text-amber-800 dark:text-amber-200 text-center px-4 leading-tight">${esc(label)}</span>
      </div>
      <button type="button" class="node-delete absolute -top-1.5 -right-1.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-400 hover:text-red-500 hover:border-red-300 transition-colors opacity-0 group-hover:opacity-100 z-20"
        data-flow-node-delete="${esc(node.id)}" title="Delete node">
        <span class="material-icons text-[12px]">close</span>
      </button>
      <div class="absolute left-1/2 -translate-x-1/2 -top-[5px] z-10">
        <div class="port port-in" data-port-node-id="${esc(node.id)}" data-port-type="in" title="Input"></div>
      </div>
      <div class="absolute left-1/2 -translate-x-1/2 -bottom-[5px] z-10">
        <div class="port port-out" data-port-node-id="${esc(node.id)}" data-port-type="out" title="Output"></div>
      </div>
      <div class="absolute top-1/2 -translate-y-1/2 -left-[5px] z-10">
        <div class="port port-out" data-port-node-id="${esc(node.id)}" data-port-type="out" title="Output"></div>
      </div>
      <div class="absolute top-1/2 -translate-y-1/2 -right-[5px] z-10">
        <div class="port port-out" data-port-node-id="${esc(node.id)}" data-port-type="out" title="Output"></div>
      </div>
    </div>
  `;
}

function renderRectangleNode(
  node: TranscriptFlowNode,
  pos: { x: number; y: number },
  size: { width: number; height: number },
  label: string,
): string {
  return `
    <div class="canvas-node pointer-events-auto bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 rounded-lg shadow-lg cursor-pointer select-none group"
         data-flow-node-id="${esc(node.id)}"
         style="left:${pos.x}px; top:${pos.y}px; width:${size.width}px; height:${size.height}px;">
      <div class="node-header flex items-center justify-center w-full h-full cursor-move rounded-lg px-3">
        <span class="text-xs font-bold text-slate-800 dark:text-slate-100 text-center leading-tight">${esc(label)}</span>
      </div>
      <button type="button" class="node-delete absolute -top-1.5 -right-1.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-400 hover:text-red-500 hover:border-red-300 transition-colors opacity-0 group-hover:opacity-100"
        data-flow-node-delete="${esc(node.id)}" title="Delete node">
        <span class="material-icons text-[12px]">close</span>
      </button>
      <div class="absolute left-1/2 -translate-x-1/2 -top-[5px]">
        <div class="port port-in" data-port-node-id="${esc(node.id)}" data-port-type="in" title="Input"></div>
      </div>
      <div class="absolute left-1/2 -translate-x-1/2 -bottom-[5px]">
        <div class="port port-out" data-port-node-id="${esc(node.id)}" data-port-type="out" title="Output"></div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Overlays & Utilities
// ---------------------------------------------------------------------------

export function renderGeneratingOverlay(generatingThoughts: string[]): string {
  return `
    <div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-in slide-in-from-bottom-4">
      <div class="w-[22rem] max-w-full rounded-2xl border border-primary/25 bg-white/95 dark:bg-slate-900/95 shadow-2xl px-4 py-3 backdrop-blur-md flex items-center gap-4">
        <span class="relative inline-flex h-8 w-8 items-center justify-center shrink-0">
          <span class="absolute inset-0 rounded-full border-2 border-primary/25"></span>
          <span class="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin"></span>
          <span class="absolute h-2 w-2 rounded-full bg-primary/80 animate-pulse"></span>
        </span>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-bold text-slate-800 dark:text-slate-100">Agent building diagram...</div>
          <div class="h-4 overflow-hidden relative w-full -mt-0.5">
            <div class="absolute inset-0 scale-[0.9] origin-left -ml-2">
              ${renderThinkingMessages(generatingThoughts)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderThinkingMessages(messages: string[]): string {
  const selected = messages.length > 0 ? messages : ['Analyzing transcript...'];
  const durationSeconds = Math.max(selected.length * GENERATING_THOUGHT_STEP_SECONDS, 2);
  return `
    <div class="thinking-message-stack mt-2 h-5 w-full max-w-[320px]" style="--thinking-duration:${durationSeconds}s">
      ${selected.map((message, index) => `
        <p class="thinking-message absolute inset-0 text-center text-[11px] text-slate-500 dark:text-slate-400 font-mono"
          style="animation-delay:${index * GENERATING_THOUGHT_STEP_SECONDS}s">${esc(message)}</p>
      `).join('')}
    </div>
  `;
}

function measureLabelWidth(text: string): number {
  // Approximate: 8px per character at 13px bold font
  return Math.max(20, text.length * 8);
}
