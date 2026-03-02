import { TRANSCRIPT_BLOCK_PALETTE } from '../../models';
import { buildNodeColorStyles, getAutoNodeColor, readNodeColorMeta } from '../../node-colors';
import { resolveNodeIcon } from '../../node-icons';
import type { TranscriptFlowResult } from '../../transcript-flow';
import { themeToggleHTML } from '../../theme';
import { GENERATING_THOUGHT_STEP_SECONDS } from './constants';
import {
  esc,
  messageClass,
  renderModelOptions,
  shortId,
  trimForPreview,
} from './format';
import { defaultNodeSize, edgeGeometry } from './layout';
import type {
  FlowRenderState,
  MessageTone,
  TranscriptFile,
  WorkspaceSaveStatus,
} from './types';

interface TranscriptImportShellModel {
  baseUrl: string;
  projectName: string;
  projectModel: string;
  linkedProjectId: string | null;
  assistantName: string;
  userName: string;
  transcripts: TranscriptFile[];
  generationError: string;
  persistenceMessage: { tone: MessageTone; text: string } | null;
  generatedPromptMarkdown: string;
  promptGenerationMessage: { tone: MessageTone; text: string } | null;
  isGeneratingPrompt: boolean;
  canGenerate: boolean;
  isGenerating: boolean;
  isHydratingWorkspace: boolean;
  processingProgress: { processed: number; total: number } | null;
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
    persistenceMessage,
    generatedPromptMarkdown,
    promptGenerationMessage,
    isGeneratingPrompt,
    canGenerate,
    isGenerating,
    isHydratingWorkspace,
    processingProgress,
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
          <h1 class="text-sm font-semibold leading-none">Import Transcript (AI)</h1>
          <span class="text-[10px] text-slate-400 uppercase tracking-wider">Generate a hypothetical call-flow diagram</span>
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
          <button id="btn-create-flow-project" type="button" class="ui-btn ui-btn-outline" title="Fallback: link this flow to a canvas project">
            <span class="material-icons text-sm">link</span> Link Canvas Project
          </button>
        `}
          <button id="btn-generate-prompt-from-flow" type="button" class="ui-btn ui-btn-outline" ${isGeneratingPrompt ? 'disabled' : ''}>
            <span class="material-icons text-sm">auto_fix_high</span> ${isGeneratingPrompt ? 'Generating Prompt...' : 'Generate Prompt'}
          </button>
        `
    : ''}
        ${themeToggleHTML()}
        <button id="btn-back" class="ui-btn ui-btn-ghost">
          Back
        </button>
      </div>
    </header>

    <main class="ui-main ui-stack-lg">
      <aside class="ui-sidebar border-r border-primary/10 bg-white dark:bg-background-dark/50 z-10">
        <div class="ui-scroll p-4 space-y-3 custom-scrollbar" data-scroll-preserve="transcript-import-sidebar">
          <section class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/40">
            <button
              id="btn-toggle-input-section"
              type="button"
              class="w-full px-3 py-2.5 flex items-center justify-between text-left"
              aria-expanded="${inputSectionCollapsed ? 'false' : 'true'}"
            >
              <span class="text-[11px] font-bold tracking-wider uppercase text-slate-500">Input Transcript</span>
              <span class="material-icons text-sm text-slate-400 transition-transform ${inputSectionCollapsed ? '-rotate-90' : ''}">expand_more</span>
            </button>
            <div class="${inputSectionCollapsed ? 'hidden' : ''} px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <p class="text-xs text-slate-500 dark:text-slate-400">Upload or paste transcripts, then generate or regenerate the flow.</p>

              <div>
                <label for="transcript-project-name" class="block text-xs font-medium text-slate-500 mb-1">Project name</label>
                <input id="transcript-project-name" value="${esc(projectName)}" class="ui-input" />
              </div>
              <div>
                <label for="transcript-project-model" class="block text-xs font-medium text-slate-500 mb-1">Target model</label>
                <select id="transcript-project-model" class="ui-select">
                  ${renderModelOptions(projectModel)}
                </select>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label for="transcript-assistant-name" class="block text-xs font-medium text-slate-500 mb-1">Assistant label</label>
                  <input id="transcript-assistant-name" value="${esc(assistantName)}" class="ui-input" placeholder="Assistant" />
                </div>
                <div>
                  <label for="transcript-user-name" class="block text-xs font-medium text-slate-500 mb-1">User label</label>
                  <input id="transcript-user-name" value="${esc(userName)}" class="ui-input" placeholder="User" />
                </div>
              </div>
              <div>
                <div class="flex items-center justify-between gap-2 mb-1">
                  <label class="text-xs font-medium text-slate-500">Transcript Corpus</label>
                  <span id="transcript-corpus-count" class="text-[11px] text-slate-400">${transcripts.length} files</span>
                </div>

                <div id="transcript-drop-zone" class="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-4 text-center hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer">
                  <div class="flex flex-col items-center gap-2 pointer-events-none">
                    <span class="material-icons text-slate-400">cloud_upload</span>
                    <p class="text-[11px] text-slate-500">Drag &amp; drop files here, or <span class="text-primary cursor-pointer hover:underline pointer-events-auto" id="btn-upload-transcript">browse</span></p>
                    <p class="text-[9px] text-slate-400">Supports .txt, .srt, .vtt, .csv (up to 100 files)</p>
                  </div>
                  <input id="transcript-file" type="file" multiple accept=".txt,.md,.log,.json,.csv,.srt,.vtt" class="hidden" />
                </div>

                ${transcripts.length > 0
    ? `
                    <div class="mt-3 max-h-48 overflow-y-auto custom-scrollbar space-y-1 pr-1" id="transcript-list">
                      ${transcripts
      .map((transcript) => `
                        <div class="flex items-center justify-between gap-2 p-2 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                          <div class="min-w-0 flex-1">
                            <p class="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate" title="${esc(transcript.name)}">${esc(transcript.name)}</p>
                            <p class="text-[9px] text-slate-400">${(transcript.content.length / 1024).toFixed(1)} KB</p>
                          </div>
                          <button type="button" class="text-slate-400 hover:text-red-500 transition-colors p-1" data-remove-transcript="${esc(transcript.id)}">
                            <span class="material-icons text-[14px]">close</span>
                          </button>
                        </div>
                      `)
      .join('')}
                    </div>
                  `
    : ''}
              </div>

              ${generationError
    ? `<p id="transcript-generate-error" class="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-200">${esc(generationError)}</p>`
    : ''}
              ${persistenceMessage
    ? `<p class="rounded-lg border px-3 py-2 text-xs ${messageClass(persistenceMessage.tone)}">${esc(persistenceMessage.text)}</p>`
    : ''}
              ${promptGenerationMessage
    ? `<p class="rounded-lg border px-3 py-2 text-xs ${messageClass(promptGenerationMessage.tone)}">${esc(promptGenerationMessage.text)}</p>`
    : ''}
              ${renderWorkspaceSaveStatus({
      transcriptSetId,
      workspaceSaveStatus,
      workspaceSaveMessage,
      workspaceSavedAt,
      isHydratingWorkspace,
    })}

              <div class="flex flex-wrap gap-2 pt-1">
                <button id="btn-generate-flow" class="flex-1 ui-btn ui-btn-primary !text-sm !py-2 disabled:opacity-50 disabled:cursor-not-allowed" ${canGenerate ? '' : 'disabled'}>
                  ${isGenerating
    ? processingProgress
      ? `Generating (${processingProgress.processed}/${processingProgress.total})...`
      : 'Generating...'
    : 'Generate Flow'}
                </button>
                <button id="btn-clear-transcript" type="button" class="ui-btn ui-btn-ghost !text-sm !py-2">
                  Clear
                </button>
              </div>

              ${generatedPromptMarkdown
    ? `
                  <section class="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                      <h3 class="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Generated Prompt</h3>
                      <button id="btn-copy-generated-prompt" type="button" class="ui-btn ui-btn-ghost !text-[11px] !px-2 !py-1.5">Copy</button>
                    </div>
                    <textarea readonly class="ui-input min-h-40 font-mono text-[11px] leading-relaxed resize-y">${esc(generatedPromptMarkdown)}</textarea>
                  </section>
                `
    : ''}
            </div>
          </section>

          <section class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/40">
            <button
              id="btn-toggle-nodes-section"
              type="button"
              class="w-full px-3 py-2.5 flex items-center justify-between text-left"
              aria-expanded="${nodesSectionCollapsed ? 'false' : 'true'}"
            >
              <span class="text-[11px] font-bold tracking-wider uppercase text-slate-500">Nodes</span>
              <span class="material-icons text-sm text-slate-400 transition-transform ${nodesSectionCollapsed ? '-rotate-90' : ''}">expand_more</span>
            </button>
            <div class="${nodesSectionCollapsed ? 'hidden' : ''} px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <p class="text-xs text-slate-500 dark:text-slate-400">Canvas controls: drag nodes, drag between ports to connect, click edge then Delete to remove, double-click edge to edit branch label.</p>
              <div class="relative">
                <span class="material-icons absolute left-2.5 top-2.5 text-slate-400 text-sm">search</span>
                <input id="flow-node-search" value="${esc(nodeSearchQuery)}" class="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-all" placeholder="Search nodes..." type="text" />
              </div>
              <div id="flow-node-blocks" class="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                ${renderFlowNodeBlocks(nodeSearchQuery)}
              </div>
            </div>
          </section>
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

export function renderEmptyCanvas(
  isGenerating: boolean,
  generatingThoughts: string[],
): string {
  const previewTitle = isGenerating ? 'Generating Flow...' : 'Flow Preview';
  const previewBody = isGenerating
    ? 'AI is analyzing the transcript and building your call flow.'
    : 'Generate a flow or drag nodes from the sidebar to start.';
  const icon = isGenerating ? 'auto_awesome' : 'account_tree';

  return `
    <div class="flex flex-col items-center justify-center h-full">
      <div class="relative group">
        <div class="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity"></div>
        <div class="relative w-48 bg-white dark:bg-slate-900 border-2 border-primary rounded-xl p-4 shadow-xl flex flex-col items-center gap-3">
          <div class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <span class="material-icons text-primary ${isGenerating ? 'animate-pulse' : ''}">${icon}</span>
          </div>
          <div class="text-center">
            <h2 class="text-sm font-bold">${previewTitle}</h2>
            <p class="text-[10px] text-slate-400">${previewBody}</p>
            ${isGenerating
    ? `
              <div class="mt-3 flex justify-center" aria-hidden="true">
                <span class="relative inline-flex h-14 w-14 items-center justify-center">
                  <span class="absolute inset-0 rounded-full border-2 border-primary/25"></span>
                  <span class="absolute inset-1 rounded-full border-2 border-primary border-t-transparent animate-spin"></span>
                  <span class="absolute h-2.5 w-2.5 rounded-full bg-primary/80 animate-pulse"></span>
                </span>
              </div>
              ${renderThinkingMessages(generatingThoughts)}
            `
    : ''}
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

  const edges = flow.connections
    .map((connection, index) => {
      const from = layout[connection.from];
      const to = layout[connection.to];
      if (!from || !to) return '';

      const fromSize = nodeSizes[connection.from] ?? defaultNodeSize();
      const toSize = nodeSizes[connection.to] ?? defaultNodeSize();
      const geometryData = edgeGeometry(from, fromSize, to, toSize);
      const isSelected = selectedConnectionIndex === index;
      const midpoint = cubicBezierPointAtHalf(
        geometryData.fromX,
        geometryData.fromY,
        geometryData.toX,
        geometryData.toY,
      );
      const reason = connection.reason.trim();

      return `
        <g data-flow-edge="${index}" data-from-id="${esc(connection.from)}" data-to-id="${esc(connection.to)}">
          <path
            data-flow-edge-path="1"
            data-flow-edge-index="${index}"
            d="${geometryData.curve}"
            stroke="#23956F"
            stroke-width="2"
            fill="none"
            class="connector-path ${isSelected ? 'connector-path-selected' : ''}"
            style="pointer-events:none"
          />
          <path
            data-flow-edge-hit-index="${index}"
            d="${geometryData.curve}"
            stroke="#23956F"
            stroke-opacity="0.001"
            stroke-width="14"
            stroke-linecap="round"
            fill="none"
            class="connector-hit cursor-pointer"
          />
          ${reason
    ? `
                <text
                  x="${midpoint.x}"
                  y="${midpoint.y - 8}"
                  text-anchor="middle"
                  class="flow-edge-label"
                  ${isSelected ? 'style="fill:#0f766e"' : ''}
                >${esc(reason)}</text>
              `
    : ''}
          <circle r="3" fill="#23956F" opacity="0.7">
            <animateMotion data-flow-edge-motion="1" dur="3s" repeatCount="indefinite" path="${geometryData.curve}" />
          </circle>
        </g>
      `;
    })
    .join('');

  const nodes = flow.nodes
    .map((node, index) => {
      const position = layout[node.id] ?? { x: 80, y: 80 };
      const safeIcon = resolveNodeIcon(node.icon, node.type);
      const displayLabel =
        node.label.trim().length > 0 ? node.label.trim() : `Step ${shortId(node.id)}`;
      const contentPreview = esc(trimForPreview(node.content, 120));
      const nodeSize = nodeSizes[node.id] ?? defaultNodeSize();
      const nodeColor = readNodeColorMeta(node.meta) ?? getAutoNodeColor(index);
      const styles = buildNodeColorStyles(nodeColor);

      return `
        <div class="canvas-node pointer-events-auto bg-white dark:bg-slate-900 border rounded-lg shadow-xl node-glow cursor-pointer"
             data-flow-node-id="${esc(node.id)}"
             style="left:${position.x}px; top:${position.y}px; width:${nodeSize.width}px; border-color:${styles.border};">
          <div class="node-header p-3 flex items-center justify-between rounded-t-lg cursor-move" style="background:${styles.headerBackground}; border-bottom:1px solid ${styles.headerBorder};">
            <h2 class="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 select-none min-w-0">
              <span class="material-icons text-sm shrink-0 w-4 overflow-hidden text-center" style="color:${styles.icon};">${safeIcon}</span>
              <span class="block truncate" title="${esc(displayLabel)}">${esc(displayLabel)}</span>
            </h2>
            <button
              type="button"
              class="node-delete h-6 w-6 inline-flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              data-flow-node-delete="${esc(node.id)}"
              title="Delete node"
            >
              <span class="material-icons text-sm">delete_outline</span>
            </button>
          </div>
          <div class="relative">
            <div class="p-3 text-[11px] text-slate-500 dark:text-slate-400 font-mono leading-relaxed max-h-24 overflow-hidden">
              ${contentPreview}
            </div>
            <div class="absolute -left-[7px] top-1/2 -translate-y-1/2">
              <div class="port port-in" data-port-node-id="${esc(node.id)}" data-port-type="in" title="Input"></div>
            </div>
            <div class="absolute -right-[7px] top-1/2 -translate-y-1/2">
              <div class="port port-out" data-port-node-id="${esc(node.id)}" data-port-type="out" title="Output"></div>
            </div>
          </div>
          <div class="bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 flex justify-end items-center rounded-b-lg border-t" style="border-top-color:${styles.footerBorder};">
            <span class="text-[9px] font-mono" style="color:${styles.tokenText};">${node.content.length > 0 ? `${Math.ceil(node.content.length / 4)} tok` : 'empty'}</span>
          </div>
        </div>
      `;
    })
    .join('');

  const infoBar = `
    <div class="absolute top-4 left-4 right-4 sm:right-auto sm:max-w-[min(90vw,60rem)] flex items-center gap-2 overflow-x-auto whitespace-nowrap custom-scrollbar text-xs font-medium text-slate-400 bg-white/80 dark:bg-background-dark/80 px-3 py-1.5 rounded-full border border-primary/10 shadow-sm z-10">
      <span class="text-slate-800 dark:text-slate-200">${esc(flow.title)}</span>
      <span class="text-[10px]">|</span>
      <span>${esc(flow.model)}</span>
      <span class="text-[10px]">&middot;</span>
      <span>${flow.nodes.length} nodes</span>
      <span class="text-[10px]">&middot;</span>
      <span>${flow.connections.length} connections</span>
      ${selectedConnectionIndex !== null
    ? `
          <span class="text-[10px]">|</span>
          <span class="text-cyan-700 dark:text-cyan-300">edge selected</span>
        `
    : ''}
      <span class="text-[10px]">|</span>
      <span class="text-emerald-600 dark:text-emerald-300">workspace auto-save enabled</span>
      ${isGenerating
    ? `
        <span class="text-[10px]">|</span>
        <span class="inline-flex items-center gap-1 text-primary">
          <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          generating
        </span>
      `
    : ''}
    </div>
  `;

  const fallbackBanner = flow.usedFallback
    ? `<div class="absolute bottom-4 left-4 right-4 sm:right-auto sm:max-w-[min(90vw,36rem)] rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-200 z-10">${esc(flow.warning ?? 'AI unavailable, using deterministic fallback.')}</div>`
    : '';

  return `
    ${infoBar}
    ${fallbackBanner}
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

function cubicBezierPointAtHalf(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number } {
  const dx = Math.abs(toX - fromX) * 0.5;
  const c1x = fromX + dx;
  const c2x = toX - dx;
  const t = 0.5;
  const oneMinusT = 1 - t;
  const x = oneMinusT ** 3 * fromX
    + 3 * oneMinusT ** 2 * t * c1x
    + 3 * oneMinusT * t ** 2 * c2x
    + t ** 3 * toX;
  const y = oneMinusT ** 3 * fromY
    + 3 * oneMinusT ** 2 * t * fromY
    + 3 * oneMinusT * t ** 2 * toY
    + t ** 3 * toY;
  return { x, y };
}

function renderFlowNodeBlocks(searchQuery: string): string {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = TRANSCRIPT_BLOCK_PALETTE.filter((block) => {
    if (!normalizedQuery) return true;
    return (
      block.label.toLowerCase().includes(normalizedQuery)
      || block.category.toLowerCase().includes(normalizedQuery)
      || block.type.toLowerCase().includes(normalizedQuery)
    );
  });

  if (filtered.length === 0) {
    return '<p class="rounded border border-dashed border-slate-300 dark:border-slate-700 px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">No matching nodes found.</p>';
  }

  const blocksByCategory = new Map<string, typeof filtered>();
  for (const block of filtered) {
    const category = block.category;
    if (!blocksByCategory.has(category)) {
      blocksByCategory.set(category, []);
    }
    blocksByCategory.get(category)!.push(block);
  }

  return Array.from(blocksByCategory.entries())
    .map(([category, blocks]) => `
      <section>
        <h3 class="mb-1 text-[10px] font-semibold tracking-wider uppercase text-slate-400">${esc(category)}</h3>
        <div class="space-y-1">
          ${blocks
      .map((block) => `
            <div
              class="transcript-node-block sidebar-block group flex items-center gap-2 p-2 rounded border border-transparent hover:border-primary/20 hover:bg-slate-100 dark:hover:bg-white/5 cursor-grab transition-colors"
              draggable="true"
              data-flow-block-type="${esc(block.type)}"
              data-flow-block-label="${esc(block.label)}"
              data-flow-block-icon="${esc(block.icon)}"
              data-flow-block-default="${esc(encodeURIComponent(block.defaultContent))}"
            >
              <span class="material-icons text-sm text-primary">${esc(block.icon)}</span>
              <span class="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">${esc(block.label)}</span>
            </div>
          `)
      .join('')}
        </div>
      </section>
    `)
    .join('');
}

function renderWorkspaceSaveStatus(params: {
  transcriptSetId: string | null;
  workspaceSaveStatus: WorkspaceSaveStatus;
  workspaceSaveMessage: string | null;
  workspaceSavedAt: string | null;
  isHydratingWorkspace: boolean;
}): string {
  const {
    transcriptSetId,
    workspaceSaveStatus,
    workspaceSaveMessage,
    workspaceSavedAt,
    isHydratingWorkspace,
  } = params;

  if (isHydratingWorkspace) {
    return `<p class="rounded-lg border px-3 py-2 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200">Loading transcript workspace...</p>`;
  }

  if (!transcriptSetId) {
    return '<p class="rounded-lg border px-3 py-2 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200">Generate a flow to create and auto-save a transcript workspace and linked Canvas project.</p>';
  }

  if (workspaceSaveStatus === 'saving') {
    return '<p class="rounded-lg border px-3 py-2 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200">Saving workspace changes...</p>';
  }

  if (workspaceSaveStatus === 'error') {
    const message = workspaceSaveMessage ?? 'Failed to save workspace changes.';
    return `<p class="rounded-lg border px-3 py-2 text-xs border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-200">${esc(message)}</p>`;
  }

  if (workspaceSaveStatus === 'saved' && workspaceSavedAt) {
    const savedAt = new Date(workspaceSavedAt);
    const formatted = Number.isNaN(savedAt.getTime())
      ? workspaceSavedAt
      : savedAt.toLocaleString();
    return `<p class="rounded-lg border px-3 py-2 text-xs border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-200">Workspace saved at ${esc(formatted)}.</p>`;
  }

  return '<p class="rounded-lg border px-3 py-2 text-xs border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 text-slate-700 dark:text-slate-200">Workspace ready.</p>';
}

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
          <div class="text-xs font-bold text-slate-800 dark:text-slate-100">Iterating on graph...</div>
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
  const durationSeconds = Math.max(
    selected.length * GENERATING_THOUGHT_STEP_SECONDS,
    2,
  );
  return `
    <div class="thinking-message-stack mt-2 h-5 w-full max-w-[320px]" style="--thinking-duration:${durationSeconds}s">
      ${selected
    .map(
      (message, index) => `
        <p
          class="thinking-message absolute inset-0 text-center text-[11px] text-slate-500 dark:text-slate-400 font-mono"
          style="animation-delay:${index * GENERATING_THOUGHT_STEP_SECONDS}s"
        >${esc(message)}</p>
      `,
    )
    .join('')}
    </div>
  `;
}
