
import { computeDiff, toSideBySideHTML } from '../diff';
import {
  clearGitHubPromptSyncConfig,
  createGitHubConnectUrl,
  disconnectGitHubConnection,
  getGitHubConnectionStatus,
  loadGitHubPromptSyncConfig,
  normalizeGitHubPromptSyncConfig,
  readPromptFileFromGitHub,
  saveGitHubPromptSyncConfig,
  upsertPromptFileToGitHub,
  type GitHubConnectionStatus,
  type GitHubPromptSyncConfig,
} from '../github';
import type { Connection, PromptGraphSnapshot, PromptNode } from '../models';
import { router } from '../router';
import { store } from '../store';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { preserveScrollDuringRender } from '../view-state';
import { projectViewTabsHTML, wireEscapeToCanvas, wireProjectViewTabs } from './project-nav';

type BannerTone = 'success' | 'error' | 'info';
type NodeDiffStatus = 'unchanged' | 'modified' | 'added' | 'removed';

interface BannerMessage {
  tone: BannerTone;
  text: string;
}

interface GitHubDraft {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  commitMessage: string;
}

interface GraphDiffResult {
  oldStatusById: Map<string, NodeDiffStatus>;
  newStatusById: Map<string, NodeDiffStatus>;
  changedNodeIds: string[];
  changedNodeIdSet: Set<string>;
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

interface GraphViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

const EMPTY_CONNECTION_STATUS: GitHubConnectionStatus = {
  connected: false,
  accountLogin: '',
  accountType: '',
};

const EMPTY_GRAPH_DIFF: GraphDiffResult = {
  oldStatusById: new Map(),
  newStatusById: new Map(),
  changedNodeIds: [],
  changedNodeIdSet: new Set(),
  stats: {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: 0,
  },
};

const NODE_WIDTH = 240;
const NODE_HEIGHT = 170;
const GRID_COLS = 3;
const GRID_PAD = 48;
const GRID_GAP_X = 84;
const GRID_GAP_Y = 72;
const DIFF_SIDEBAR_COLLAPSED_STORAGE_KEY = 'spoqen.diff.sidebar.collapsed';

export function renderDiff(container: HTMLElement, projectId: string): void {
  const project = store.getProject(projectId);
  if (!project) {
    router.navigate('/');
    return;
  }

  const savedConfig = loadGitHubPromptSyncConfig(projectId);
  let githubDraft: GitHubDraft = {
    owner: savedConfig?.owner ?? '',
    repo: savedConfig?.repo ?? '',
    branch: savedConfig?.branch ?? 'main',
    filePath: savedConfig?.filePath ?? 'prompt.md',
    commitMessage: defaultCommitMessage(project.name),
  };

  let leftIdx = 0;
  let rightIdx = 0;
  let selectedNodeId: string | null = null;
  let pendingNodeSync = false;

  let snapshotMessage: BannerMessage | null = null;
  let githubMessage: BannerMessage | null = null;
  let githubBusy = false;
  let connectionStatus = EMPTY_CONNECTION_STATUS;
  let connectionStatusLoaded = false;
  let connectionStatusBusy = false;
  let sidebarCollapsed = loadSidebarCollapsedState();
  let nodeDiffCollapsed = true;
  const graphViewportState: Record<'old' | 'new', GraphViewportState> = {
    old: { panX: 24, panY: 24, zoom: 1 },
    new: { panX: 24, panY: 24, zoom: 1 },
  };
  const graphViewportCleanup: Partial<Record<'old' | 'new', () => void>> = {};

  const selectLatestPair = (): void => {
    const versions = store.getVersions(projectId);
    rightIdx = versions.length > 0 ? versions.length - 1 : 0;
    leftIdx = versions.length > 1 ? versions.length - 2 : 0;
  };

  const clampSelection = (): void => {
    const versions = store.getVersions(projectId);
    const maxIdx = Math.max(versions.length - 1, 0);
    leftIdx = clamp(leftIdx, 0, maxIdx);
    rightIdx = clamp(rightIdx, 0, maxIdx);
  };

  selectLatestPair();

  const readFieldValue = (selector: string): string => {
    const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
    return field?.value.trim() ?? '';
  };

  const syncGitHubDraftFromForm = (): void => {
    githubDraft = {
      owner: readFieldValue('#gh-owner'),
      repo: readFieldValue('#gh-repo'),
      branch: readFieldValue('#gh-branch') || 'main',
      filePath: readFieldValue('#gh-path'),
      commitMessage: readFieldValue('#gh-commit-message') || defaultCommitMessage(project.name),
    };
  };

  const refreshConnectionStatus = async (): Promise<void> => {
    connectionStatusBusy = true;
    render();
    try {
      connectionStatus = await getGitHubConnectionStatus();
      connectionStatusLoaded = true;
    } catch (err) {
      connectionStatus = EMPTY_CONNECTION_STATUS;
      connectionStatusLoaded = true;
      githubMessage = { tone: 'error', text: toErrorMessage(err) };
    } finally {
      connectionStatusBusy = false;
      render();
    }
  };

  const render = (): void => {
    clampSelection();

    const versions = store.getVersions(projectId);
    const hasComparableVersions = versions.length >= 2;
    const oldVersion = hasComparableVersions ? versions[leftIdx] : null;
    const newVersion = hasComparableVersions ? versions[rightIdx] : null;

    const oldSnapshot = oldVersion?.snapshot ?? null;
    const newSnapshot = newVersion?.snapshot ?? null;
    const graphDiff = oldSnapshot && newSnapshot
      ? diffGraphSnapshots(oldSnapshot, newSnapshot)
      : EMPTY_GRAPH_DIFF;

    if (selectedNodeId && !graphDiff.changedNodeIdSet.has(selectedNodeId)) {
      selectedNodeId = null;
    }
    if (!selectedNodeId && graphDiff.changedNodeIds.length > 0) {
      selectedNodeId = graphDiff.changedNodeIds[0];
    }

    const selectedOldNode = selectedNodeId && oldSnapshot ? findNode(oldSnapshot, selectedNodeId) : null;
    const selectedNewNode = selectedNodeId && newSnapshot ? findNode(newSnapshot, selectedNodeId) : null;
    const selectedOldStatus = selectedNodeId ? graphDiff.oldStatusById.get(selectedNodeId) ?? null : null;
    const selectedNewStatus = selectedNodeId ? graphDiff.newStatusById.get(selectedNodeId) ?? null : null;

    const selectedOldText = formatNodeForDiff(selectedOldNode);
    const selectedNewText = formatNodeForDiff(selectedNewNode);
    const selectedDiffEntries = selectedNodeId ? computeDiff(selectedOldText, selectedNewText) : [];
    const selectedDiff = selectedNodeId
      ? toSideBySideHTML(selectedDiffEntries)
      : { leftHTML: '', rightHTML: '', stats: { added: 0, removed: 0, unchanged: 0 } };

    const hasLegacySnapshotGap = hasComparableVersions && (!oldSnapshot || !newSnapshot);

    const recentVersions = versions
      .map((version, index) => ({ version, index }))
      .slice(Math.max(versions.length - 10, 0))
      .reverse();

    const githubOpsDisabled = githubBusy || connectionStatusBusy || !connectionStatus.connected;
    const graphPaneHeightClass = nodeDiffCollapsed ? 'min-h-[720px]' : 'min-h-[560px]';
    const connectionLabel = connectionStatusBusy
      ? 'Checking GitHub connection...'
      : connectionStatus.connected
        ? `Connected as ${connectionStatus.accountLogin || 'GitHub user'}`
        : connectionStatusLoaded
          ? 'Not connected'
          : 'Connection not loaded';

    const disposeViewportListeners = (): void => {
      graphViewportCleanup.old?.();
      graphViewportCleanup.new?.();
      delete graphViewportCleanup.old;
      delete graphViewportCleanup.new;
    };

    preserveScrollDuringRender(container, () => {
      container.innerHTML = `
      <header class="h-14 border-b border-primary/10 bg-white dark:bg-background-dark relative flex items-center px-4 z-30">
        <div class="flex items-center gap-2">
          <button type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer rounded" id="nav-home" aria-label="Go to dashboard">
            <img src="/Icon.svg" alt="Spoqen" class="w-8 h-8 object-contain" />
          </button>
          <div>
            <h1 class="text-sm font-semibold leading-none">${escapeHtml(project.name)}</h1>
            <span class="text-[10px] text-slate-400 uppercase tracking-wider">Graph Diff</span>
          </div>
        </div>
        <div class="absolute left-1/2 -translate-x-1/2">
          ${projectViewTabsHTML('diff')}
        </div>
        <div class="ml-auto flex items-center gap-3">
          ${themeToggleHTML()}
          <button id="btn-back" class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-primary/20 rounded text-primary hover:bg-primary/5 transition-colors">
            <span class="material-icons text-sm">arrow_back</span>
            Back to Canvas
          </button>
        </div>
      </header>

      <main class="flex-1 flex overflow-x-hidden overflow-y-auto" data-scroll-preserve="diff-main">
        <section class="flex-1 flex flex-col">
          <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-2">
            <button id="btn-save-snapshot" class="px-3 py-1.5 text-xs font-medium border border-primary/30 text-primary hover:bg-primary/5 rounded transition-colors">
              Save Snapshot
            </button>
            <input id="snapshot-note" type="text" class="min-w-[240px] flex-1 px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" placeholder="Snapshot note (optional)" />
            <button id="btn-compare-latest" class="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Compare Latest
            </button>
            <div class="ml-auto flex items-center gap-2">
              <button id="btn-toggle-node-diff" class="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                ${nodeDiffCollapsed ? 'Show Text Diff' : 'Hide Text Diff'}
              </button>
              <button id="btn-toggle-sidebar" class="px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                ${sidebarCollapsed ? 'Show Right Panel' : 'Hide Right Panel'}
              </button>
            </div>
          </div>

          ${renderBanner(snapshotMessage)}

          ${hasComparableVersions ? `
            <div class="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <div class="flex items-center gap-2">
                  <label class="text-xs font-medium text-slate-500">Old</label>
                  <select id="select-left" class="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 focus:ring-1 focus:ring-primary outline-none">
                    ${versions.map((version, index) => `
                      <option value="${index}" ${index === leftIdx ? 'selected' : ''}>
                        ${escapeHtml(formatVersionLabel(version.timestamp, version.notes))}
                      </option>
                    `).join('')}
                  </select>
                </div>
                <span class="material-icons text-primary">compare_arrows</span>
                <div class="flex items-center gap-2">
                  <label class="text-xs font-medium text-slate-500">New</label>
                  <select id="select-right" class="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 focus:ring-1 focus:ring-primary outline-none">
                    ${versions.map((version, index) => `
                      <option value="${index}" ${index === rightIdx ? 'selected' : ''}>
                        ${escapeHtml(formatVersionLabel(version.timestamp, version.notes))}
                      </option>
                    `).join('')}
                  </select>
                </div>
              </div>

              <div class="flex items-center gap-4 text-xs font-mono">
                <span class="text-emerald-600 font-bold">+${graphDiff.stats.added} added</span>
                <span class="text-red-600 font-bold">-${graphDiff.stats.removed} removed</span>
                <span class="text-amber-600 font-bold">~${graphDiff.stats.modified} modified</span>
                <span class="text-slate-500">=${graphDiff.stats.unchanged} unchanged</span>
              </div>
            </div>

            ${hasLegacySnapshotGap ? `
              <p class="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 px-3 py-2 text-xs">
                One of these versions is missing graph snapshot data. Save a new snapshot to enable full graph-to-graph comparison.
              </p>
            ` : ''}

            <div class="px-4 pt-3 flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-300">
              <span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"></span>Added node</span>
              <span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-red-500"></span>Removed node</span>
              <span class="inline-flex items-center gap-1.5"><span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>Modified node</span>
            </div>

            <div class="p-4 pt-3 grid grid-cols-1 xl:grid-cols-2 gap-4 bg-white dark:bg-slate-900">
              ${renderGraphPaneMarkup('old', oldVersion?.timestamp ?? Date.now(), oldSnapshot, graphDiff.oldStatusById, selectedNodeId, graphPaneHeightClass, graphViewportState.old)}
              ${renderGraphPaneMarkup('new', newVersion?.timestamp ?? Date.now(), newSnapshot, graphDiff.newStatusById, selectedNodeId, graphPaneHeightClass, graphViewportState.new)}

              <section class="2xl:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 overflow-hidden min-h-[80px]">
                <header class="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 flex items-center justify-between">
                  <div class="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    ${selectedNodeId
          ? `Node Diff: ${escapeHtml(selectedNodeId)}`
          : 'Node Diff'}
                  </div>
                  <div class="flex items-center gap-3">
                    <button id="btn-toggle-node-diff-inline" class="px-2 py-1 text-[11px] font-medium border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                      ${nodeDiffCollapsed ? 'Expand' : 'Collapse'}
                    </button>
                    ${selectedNodeId ? `
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      Old: ${escapeHtml(selectedOldStatus ?? 'n/a')} | New: ${escapeHtml(selectedNewStatus ?? 'n/a')}
                    </div>
                    ` : ''}
                  </div>
                </header>

                ${nodeDiffCollapsed ? `
                  <div class="h-[56px] flex items-center px-3 text-xs text-slate-500 dark:text-slate-400">
                    Text diff is collapsed. Expand to compare node content.
                  </div>
                ` : selectedNodeId ? `
                  <div class="grid grid-cols-1 xl:grid-cols-2 h-[400px]">
                    <div class="border-r border-slate-200 dark:border-slate-700 overflow-auto custom-scrollbar">
                      <div class="px-2 py-1 border-b border-slate-100 dark:border-slate-800 bg-red-50 dark:bg-red-900/10 text-xs font-medium text-slate-500 sticky top-0">
                        <span class="text-red-500 font-bold">OLD NODE</span>
                      </div>
                      <div class="p-2 font-mono text-xs">${selectedDiff.leftHTML}</div>
                    </div>
                    <div class="overflow-auto custom-scrollbar">
                      <div class="px-2 py-1 border-b border-slate-100 dark:border-slate-800 bg-green-50 dark:bg-green-900/10 text-xs font-medium text-slate-500 sticky top-0">
                        <span class="text-primary font-bold">NEW NODE</span>
                      </div>
                      <div class="p-2 font-mono text-xs">${selectedDiff.rightHTML}</div>
                    </div>
                  </div>
                  ${(selectedOldNode && selectedNewNode && selectedOldNode.content === selectedNewNode.content)
          ? '<p class="px-3 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">Node content is unchanged. Highlighting is from label/type/icon/meta/connection changes.</p>'
          : ''}
                ` : `
                  <div class="h-[260px] flex items-center justify-center text-center px-6">
                    <p class="text-sm text-slate-500 dark:text-slate-400">Select a highlighted node in either graph to compare node content side-by-side.</p>
                  </div>
                `}
              </section>
            </div>
          ` : `
            <div class="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <span class="material-icons text-6xl text-slate-300">difference</span>
              <h2 class="text-xl font-bold text-slate-600 dark:text-slate-300">Need at least 2 snapshots</h2>
              <p class="text-sm text-slate-400 max-w-md">
                Save a snapshot of the current graph and prompt, make changes in Canvas or Editor, then save another snapshot to compare graph evolution over time.
              </p>
            </div>
          `}
        </section>

        ${sidebarCollapsed ? '' : `
        <aside class="w-[360px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 transition-[width] duration-200 ease-out max-h-[calc(100vh-56px)] flex flex-col">
          <div class="px-2 py-2 border-b border-slate-200 dark:border-slate-800 flex justify-end">
            <button
              id="btn-toggle-sidebar-rail"
              class="h-7 w-7 inline-flex items-center justify-center rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              title="Collapse right panel"
              aria-label="Collapse right panel"
            >
              <span class="material-icons text-sm">chevron_right</span>
            </button>
          </div>
          <div class="p-4 space-y-6 overflow-y-auto custom-scrollbar" data-scroll-preserve="diff-sidebar">
              <section class="space-y-3">
                <div>
                  <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Snapshot History</h2>
                  <p class="text-xs text-slate-500 dark:text-slate-400">Quickly pick versions for Old/New comparison.</p>
                </div>
                <div class="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  ${recentVersions.length > 0 ? recentVersions.map(({ version, index }) => `
                    <div class="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                      <p class="text-[11px] font-medium text-slate-700 dark:text-slate-200">${escapeHtml(formatDate(version.timestamp))}</p>
                      <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">${escapeHtml(version.notes || 'Snapshot')}</p>
                      <div class="mt-2 flex gap-2">
                        <button class="version-select px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" data-role="left" data-index="${index}">Use as Old</button>
                        <button class="version-select px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800" data-role="right" data-index="${index}">Use as New</button>
                      </div>
                    </div>
                  `).join('') : '<p class="text-xs text-slate-400">No snapshots yet.</p>'}
                </div>
              </section>

              ${graphDiff.changedNodeIds.length > 0 ? `
                <section class="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div>
                    <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Changed Nodes</h2>
                    <p class="text-xs text-slate-500 dark:text-slate-400">Click to jump and compare.</p>
                  </div>
                  <div class="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    ${graphDiff.changedNodeIds.map((nodeId) => {
          const oldNode = oldSnapshot ? findNode(oldSnapshot, nodeId) : null;
          const newNode = newSnapshot ? findNode(newSnapshot, nodeId) : null;
          const label = newNode?.label ?? oldNode?.label ?? nodeId;
          const oldStatus = graphDiff.oldStatusById.get(nodeId) ?? 'n/a';
          const newStatus = graphDiff.newStatusById.get(nodeId) ?? 'n/a';
          const active = selectedNodeId === nodeId;
          return `
                        <button class="changed-node-jump w-full text-left rounded border px-2 py-1.5 text-[11px] ${active ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}" data-node-id="${escapeHtml(nodeId)}">
                          <div class="font-medium">${escapeHtml(label)}</div>
                          <div class="mt-0.5 text-[10px] opacity-80">old=${escapeHtml(oldStatus)} | new=${escapeHtml(newStatus)}</div>
                        </button>
                      `;
        }).join('')}
                  </div>
                </section>
              ` : ''}

              <section class="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100">GitHub Prompt File Sync</h2>
                  <p class="text-xs text-slate-500 dark:text-slate-400">OAuth connection + server-side GitHub App token. Only your configured prompt file is synced.</p>
                </div>

                ${renderBanner(githubMessage)}

                <div class="rounded border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs">
                  <p class="font-medium text-slate-700 dark:text-slate-200">${escapeHtml(connectionLabel)}</p>
                  ${connectionStatus.connected && connectionStatus.accountType
          ? `<p class="mt-0.5 text-slate-500 dark:text-slate-400">${escapeHtml(connectionStatus.accountType)}</p>`
          : ''}
                </div>

                <div class="grid grid-cols-2 gap-2">
                  ${connectionStatus.connected ? `
                    <button id="btn-gh-disconnect" class="col-span-2 px-2 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60" ${connectionStatusBusy || githubBusy ? 'disabled' : ''}>
                      Disconnect GitHub
                    </button>
                  ` : `
                    <button id="btn-gh-connect" class="col-span-2 px-2 py-1.5 text-xs rounded bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-60" ${connectionStatusBusy || githubBusy ? 'disabled' : ''}>
                      Connect GitHub
                    </button>
                  `}
                </div>

                <div class="space-y-2">
                  <div class="grid grid-cols-2 gap-2">
                    <input id="gh-owner" class="w-full rounded border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800" placeholder="Owner" value="${escapeHtml(githubDraft.owner)}" />
                    <input id="gh-repo" class="w-full rounded border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800" placeholder="Repository" value="${escapeHtml(githubDraft.repo)}" />
                  </div>
                  <div class="grid grid-cols-2 gap-2">
                    <input id="gh-branch" class="w-full rounded border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800" placeholder="Branch" value="${escapeHtml(githubDraft.branch)}" />
                    <input id="gh-path" class="w-full rounded border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800" placeholder="prompt file path" value="${escapeHtml(githubDraft.filePath)}" />
                  </div>
                  <input id="gh-commit-message" class="w-full rounded border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800" placeholder="Commit message" value="${escapeHtml(githubDraft.commitMessage)}" />
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <button id="btn-gh-save" class="px-2 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" ${githubBusy ? 'disabled' : ''}>Save Settings</button>
                  <button id="btn-gh-clear" class="px-2 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" ${githubBusy ? 'disabled' : ''}>Clear Settings</button>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <button id="btn-gh-pull" class="px-2 py-1.5 text-xs rounded bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-60" ${githubOpsDisabled ? 'disabled' : ''}>Pull to Snapshot</button>
                  <button id="btn-gh-push" class="px-2 py-1.5 text-xs rounded bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60" ${githubOpsDisabled ? 'disabled' : ''}>Push Current Prompt</button>
                </div>
              </section>
          </div>
        </aside>
        `}
      </main>
      `;
    });

    const snapshotNoteInput = container.querySelector<HTMLInputElement>('#snapshot-note');
    if (snapshotNoteInput) {
      snapshotNoteInput.value = '';
    }

    container.querySelector('#nav-home')?.addEventListener('click', () => {
      disposeViewportListeners();
      router.navigate('/');
    });
    wireProjectViewTabs(container, projectId, { beforeNavigate: disposeViewportListeners });
    container.querySelector('#btn-back')?.addEventListener('click', () => {
      disposeViewportListeners();
      router.navigate(`/project/${projectId}`);
    });
    wireEscapeToCanvas(container, projectId, { onEscape: disposeViewportListeners });

    renderGraphPane(container, 'old', oldSnapshot, graphDiff.oldStatusById, selectedNodeId);
    renderGraphPane(container, 'new', newSnapshot, graphDiff.newStatusById, selectedNodeId);
    graphViewportCleanup.old?.();
    graphViewportCleanup.new?.();
    graphViewportCleanup.old = wireGraphViewport(container, 'old', graphViewportState.old);
    graphViewportCleanup.new = wireGraphViewport(container, 'new', graphViewportState.new);

    container.querySelector('#btn-reset-graph-old')?.addEventListener('click', () => {
      graphViewportState.old = { panX: 24, panY: 24, zoom: 1 };
      applyGraphViewportTransform(container, 'old', graphViewportState.old);
      render();
    });

    container.querySelector('#btn-reset-graph-new')?.addEventListener('click', () => {
      graphViewportState.new = { panX: 24, panY: 24, zoom: 1 };
      applyGraphViewportTransform(container, 'new', graphViewportState.new);
      render();
    });

    container.querySelectorAll<HTMLElement>('[data-graph-node-id]').forEach((nodeEl) => {
      nodeEl.addEventListener('click', () => {
        const nodeId = nodeEl.dataset.graphNodeId;
        if (!nodeId) return;
        selectedNodeId = nodeId;
        pendingNodeSync = true;
        render();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.changed-node-jump').forEach((button) => {
      button.addEventListener('click', () => {
        const nodeId = button.dataset.nodeId;
        if (!nodeId) return;
        selectedNodeId = nodeId;
        pendingNodeSync = true;
        render();
      });
    });

    if (pendingNodeSync && selectedNodeId) {
      centerNodeInGraphViewport(container, 'old', oldSnapshot, selectedNodeId, graphViewportState.old);
      centerNodeInGraphViewport(container, 'new', newSnapshot, selectedNodeId, graphViewportState.new);
      pendingNodeSync = false;
    }

    container.querySelector('#btn-save-snapshot')?.addEventListener('click', () => {
      const notes = readFieldValue('#snapshot-note') || 'Manual snapshot';
      const version = store.saveAssembledVersion(projectId, notes);
      if (version) {
        selectLatestPair();
        snapshotMessage = { tone: 'success', text: 'Snapshot saved.' };
      } else {
        snapshotMessage = { tone: 'info', text: 'No graph or prompt changes since the latest snapshot.' };
      }
      render();
    });

    container.querySelector('#btn-compare-latest')?.addEventListener('click', () => {
      selectLatestPair();
      selectedNodeId = null;
      snapshotMessage = null;
      render();
    });

    const toggleSidebar = (): void => {
      sidebarCollapsed = !sidebarCollapsed;
      persistSidebarCollapsedState(sidebarCollapsed);
      render();
    };
    container.querySelector('#btn-toggle-sidebar')?.addEventListener('click', toggleSidebar);
    container.querySelector('#btn-toggle-sidebar-rail')?.addEventListener('click', toggleSidebar);

    const toggleNodeDiff = (): void => {
      nodeDiffCollapsed = !nodeDiffCollapsed;
      render();
    };
    container.querySelector('#btn-toggle-node-diff')?.addEventListener('click', toggleNodeDiff);
    container.querySelector('#btn-toggle-node-diff-inline')?.addEventListener('click', toggleNodeDiff);

    container.querySelector('#select-left')?.addEventListener('change', (event) => {
      leftIdx = Number((event.target as HTMLSelectElement).value);
      selectedNodeId = null;
      render();
    });

    container.querySelector('#select-right')?.addEventListener('change', (event) => {
      rightIdx = Number((event.target as HTMLSelectElement).value);
      selectedNodeId = null;
      render();
    });

    container.querySelectorAll<HTMLButtonElement>('.version-select').forEach((button) => {
      button.addEventListener('click', () => {
        const role = button.dataset.role;
        const index = Number(button.dataset.index);
        if (!Number.isFinite(index)) return;
        if (role === 'left') {
          leftIdx = index;
        } else {
          rightIdx = index;
        }
        selectedNodeId = null;
        render();
      });
    });

    container.querySelector('#btn-gh-connect')?.addEventListener('click', () => {
      void (async () => {
        githubBusy = true;
        githubMessage = null;
        render();

        try {
          const connectUrl = await createGitHubConnectUrl(window.location.href);
          window.location.assign(connectUrl);
        } catch (err) {
          githubBusy = false;
          githubMessage = { tone: 'error', text: toErrorMessage(err) };
          render();
        }
      })();
    });

    container.querySelector('#btn-gh-disconnect')?.addEventListener('click', () => {
      void (async () => {
        githubBusy = true;
        githubMessage = null;
        render();

        try {
          await disconnectGitHubConnection();
          connectionStatus = EMPTY_CONNECTION_STATUS;
          connectionStatusLoaded = true;
          githubMessage = { tone: 'info', text: 'GitHub disconnected.' };
        } catch (err) {
          githubMessage = { tone: 'error', text: toErrorMessage(err) };
        } finally {
          githubBusy = false;
          render();
        }
      })();
    });

    container.querySelector('#btn-gh-save')?.addEventListener('click', () => {
      syncGitHubDraftFromForm();
      try {
        const config = normalizeGitHubPromptSyncConfig(githubDraft);
        saveGitHubPromptSyncConfig(projectId, config);
        githubMessage = { tone: 'success', text: 'GitHub prompt sync settings saved.' };
      } catch (err) {
        githubMessage = { tone: 'error', text: toErrorMessage(err) };
      }
      render();
    });

    container.querySelector('#btn-gh-clear')?.addEventListener('click', () => {
      clearGitHubPromptSyncConfig(projectId);
      githubDraft = {
        owner: '',
        repo: '',
        branch: 'main',
        filePath: 'prompt.md',
        commitMessage: defaultCommitMessage(project.name),
      };
      githubMessage = { tone: 'info', text: 'GitHub prompt sync settings cleared.' };
      render();
    });

    container.querySelector('#btn-gh-pull')?.addEventListener('click', () => {
      void (async () => {
        syncGitHubDraftFromForm();
        let config: GitHubPromptSyncConfig;
        try {
          config = normalizeGitHubPromptSyncConfig(githubDraft);
        } catch (err) {
          githubMessage = { tone: 'error', text: toErrorMessage(err) };
          render();
          return;
        }

        githubBusy = true;
        githubMessage = null;
        render();

        try {
          const file = await readPromptFileFromGitHub(config);
          const latestVersion = store.getVersions(projectId).at(-1);
          if (latestVersion && latestVersion.content === file.content) {
            githubMessage = { tone: 'info', text: 'Pulled file matches the latest snapshot. No new snapshot created.' };
          } else {
            store.saveVersion(projectId, file.content, `GitHub pull: ${config.owner}/${config.repo}:${config.filePath}`);
            selectLatestPair();
            selectedNodeId = null;
            githubMessage = { tone: 'success', text: 'Prompt file pulled and saved as a snapshot.' };
          }
          saveGitHubPromptSyncConfig(projectId, config);
        } catch (err) {
          githubMessage = { tone: 'error', text: toErrorMessage(err) };
        } finally {
          githubBusy = false;
          render();
        }
      })();
    });

    container.querySelector('#btn-gh-push')?.addEventListener('click', () => {
      void (async () => {
        syncGitHubDraftFromForm();
        let config: GitHubPromptSyncConfig;
        try {
          config = normalizeGitHubPromptSyncConfig(githubDraft);
        } catch (err) {
          githubMessage = { tone: 'error', text: toErrorMessage(err) };
          render();
          return;
        }

        const assembled = store.assemblePrompt(projectId);
        if (!assembled.trim()) {
          githubMessage = { tone: 'error', text: 'Current assembled prompt is empty.' };
          render();
          return;
        }

        githubBusy = true;
        githubMessage = null;
        render();

        try {
          const commitMessage = githubDraft.commitMessage || defaultCommitMessage(project.name);
          const result = await upsertPromptFileToGitHub(config, assembled, commitMessage);
          store.saveAssembledVersion(projectId, `GitHub push: ${config.owner}/${config.repo}:${config.filePath}`);
          selectLatestPair();
          selectedNodeId = null;
          saveGitHubPromptSyncConfig(projectId, config);
          githubMessage = {
            tone: 'success',
            text: `Prompt pushed to GitHub. Commit ${result.commitSha.slice(0, 7)}.`,
          };
        } catch (err) {
          githubMessage = { tone: 'error', text: toErrorMessage(err) };
        } finally {
          githubBusy = false;
          render();
        }
      })();
    });

    wireThemeToggle(container);
  };

  render();
  void refreshConnectionStatus();
}

function renderGraphPaneMarkup(
  side: 'old' | 'new',
  timestamp: number,
  snapshot: PromptGraphSnapshot | null,
  statusById: Map<string, NodeDiffStatus>,
  selectedNodeId: string | null,
  paneMinHeightClass: string,
  viewportState: GraphViewportState,
): string {
  const title = side === 'old' ? 'Old Graph' : 'New Graph';
  const nodeCount = snapshot?.nodes.length ?? 0;
  const changedCount = snapshot
    ? snapshot.nodes.filter((node) => {
      const status = statusById.get(node.id);
      return status === 'modified' || status === 'added' || status === 'removed';
    }).length
    : 0;

  return `
    <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 overflow-hidden ${paneMinHeightClass} flex flex-col">
      <header class="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 flex items-center justify-between">
        <div>
          <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">${escapeHtml(title)}</p>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">${escapeHtml(formatDate(timestamp))}</p>
        </div>
        <div class="text-[11px] text-slate-500 dark:text-slate-400 text-right">
          <div>${nodeCount} nodes</div>
          <div>${changedCount} changed</div>
        </div>
      </header>

      <div id="graph-panel-${side}" class="flex-1 min-h-0 relative overflow-hidden blueprint-grid cursor-grab">
        ${snapshot ? `
          <div id="graph-stage-${side}" class="absolute left-0 top-0 origin-top-left will-change-transform">
            <svg id="graph-svg-${side}" class="absolute left-0 top-0 pointer-events-none"></svg>
            <div id="graph-nodes-${side}" class="absolute left-0 top-0"></div>
          </div>
        ` : `
          <div class="h-full flex items-center justify-center px-6 text-center">
            <p class="text-xs text-slate-500 dark:text-slate-400">No graph snapshot for this version yet.</p>
          </div>
        `}
      </div>

      <footer class="px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/70 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between gap-3">
        <span>${selectedNodeId ? `Selected: ${escapeHtml(selectedNodeId)}` : 'Right-click + drag to pan, wheel to zoom.'}</span>
        <span class="flex items-center gap-2">
          <span class="font-mono">${Math.round(viewportState.zoom * 100)}%</span>
          <button id="btn-reset-graph-${side}" class="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-[11px]">Reset View</button>
        </span>
      </footer>
    </section>
  `;
}

function renderGraphPane(
  container: HTMLElement,
  side: 'old' | 'new',
  snapshot: PromptGraphSnapshot | null,
  statusById: Map<string, NodeDiffStatus>,
  selectedNodeId: string | null,
): void {
  if (!snapshot) return;

  const nodesLayer = container.querySelector<HTMLElement>(`#graph-nodes-${side}`);
  const svgLayer = container.querySelector<SVGSVGElement>(`#graph-svg-${side}`);
  const stage = container.querySelector<HTMLElement>(`#graph-stage-${side}`);
  if (!nodesLayer || !svgLayer || !stage) return;

  const layout = buildGraphLayout(snapshot);
  stage.style.width = `${layout.width}px`;
  stage.style.height = `${layout.height}px`;
  nodesLayer.style.width = `${layout.width}px`;
  nodesLayer.style.height = `${layout.height}px`;
  svgLayer.setAttribute('width', String(layout.width));
  svgLayer.setAttribute('height', String(layout.height));

  nodesLayer.innerHTML = layout.nodes.map((node) => {
    const status = statusById.get(node.id) ?? 'unchanged';
    const statusPalette = paletteForStatus(status);
    const isSelected = selectedNodeId === node.id;
    return `
      <button
        type="button"
        data-graph-node-id="${escapeHtml(node.id)}"
        class="graph-diff-node absolute text-left rounded-lg border shadow-sm node-glow ${statusPalette.container} ${isSelected ? 'ring-2 ring-sky-400 shadow-lg' : ''}"
        style="left:${node.x}px; top:${node.y}px; width:${NODE_WIDTH}px;"
        title="${escapeHtml(node.label)}"
      >
        <div class="px-3 py-2 border-b ${statusPalette.headerBorder} ${statusPalette.headerBg} flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
            <span class="material-icons text-sm">${escapeHtml(node.icon || 'description')}</span>
            ${escapeHtml(node.label)}
          </span>
          <span class="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${statusPalette.badge}">${escapeHtml(status)}</span>
        </div>
        <div class="px-3 py-2 text-[11px] font-mono text-slate-600 dark:text-slate-300 line-clamp-4 min-h-[88px]">
          ${escapeHtml(trimForPreview(node.content))}
        </div>
        <div class="px-3 py-1.5 border-t border-slate-200/70 dark:border-slate-700/70 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide flex items-center justify-between">
          <span>${escapeHtml(node.type)}</span>
          <span>${Math.max(0, Math.ceil(node.content.length / 4))} tok</span>
        </div>
      </button>
    `;
  }).join('');

  const nodeIndex = new Map<string, { x: number; y: number }>();
  for (const node of layout.nodes) {
    nodeIndex.set(node.id, { x: node.x, y: node.y });
  }

  svgLayer.innerHTML = snapshot.connections.map((connection) => {
    const from = nodeIndex.get(connection.from);
    const to = nodeIndex.get(connection.to);
    if (!from || !to) return '';

    const x1 = from.x + NODE_WIDTH;
    const y1 = from.y + NODE_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_HEIGHT / 2;
    const selected = selectedNodeId !== null && (connection.from === selectedNodeId || connection.to === selectedNodeId);

    return `<path d="M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}" stroke="${selected ? '#0ea5e9' : '#23956F'}" stroke-width="${selected ? '3' : '2'}" fill="none" stroke-dasharray="${selected ? '7,4' : '5,5'}" class="connector-path" />`;
  }).join('');
}

function applyGraphViewportTransform(
  container: HTMLElement,
  side: 'old' | 'new',
  state: GraphViewportState,
): void {
  const stage = container.querySelector<HTMLElement>(`#graph-stage-${side}`);
  if (!stage) return;
  stage.style.transformOrigin = '0 0';
  stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
}

function wireGraphViewport(
  container: HTMLElement,
  side: 'old' | 'new',
  state: GraphViewportState,
): () => void {
  const panel = container.querySelector<HTMLElement>(`#graph-panel-${side}`);
  if (!panel) return () => {};

  applyGraphViewportTransform(container, side, state);

  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let startPanX = 0;
  let startPanY = 0;

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 2 && event.button !== 1) return;
    isPanning = true;
    panStartX = event.clientX;
    panStartY = event.clientY;
    startPanX = state.panX;
    startPanY = state.panY;
    panel.classList.add('cursor-grabbing');
    event.preventDefault();
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!isPanning) return;
    state.panX = startPanX + (event.clientX - panStartX);
    state.panY = startPanY + (event.clientY - panStartY);
    applyGraphViewportTransform(container, side, state);
  };

  const onMouseUp = (): void => {
    if (!isPanning) return;
    isPanning = false;
    panel.classList.remove('cursor-grabbing');
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const panelRect = panel.getBoundingClientRect();
    const cursorX = event.clientX - panelRect.left;
    const cursorY = event.clientY - panelRect.top;
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = clamp(state.zoom * zoomFactor, 0.35, 2.5);

    const worldX = (cursorX - state.panX) / state.zoom;
    const worldY = (cursorY - state.panY) / state.zoom;
    state.panX = cursorX - worldX * nextZoom;
    state.panY = cursorY - worldY * nextZoom;
    state.zoom = nextZoom;

    applyGraphViewportTransform(container, side, state);
  };

  panel.addEventListener('contextmenu', onContextMenu);
  panel.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  panel.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    panel.removeEventListener('contextmenu', onContextMenu);
    panel.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    panel.removeEventListener('wheel', onWheel);
  };
}

function centerNodeInGraphViewport(
  container: HTMLElement,
  side: 'old' | 'new',
  snapshot: PromptGraphSnapshot | null,
  nodeId: string,
  state: GraphViewportState,
): void {
  if (!snapshot) return;
  const panel = container.querySelector<HTMLElement>(`#graph-panel-${side}`);
  if (!panel) return;

  const layout = buildGraphLayout(snapshot);
  const node = layout.nodes.find((entry) => entry.id === nodeId);
  if (!node) return;

  const panelRect = panel.getBoundingClientRect();
  if (panelRect.width === 0 || panelRect.height === 0) return;

  const nodeCenterX = node.x + NODE_WIDTH / 2;
  const nodeCenterY = node.y + NODE_HEIGHT / 2;
  state.panX = panelRect.width / 2 - nodeCenterX * state.zoom;
  state.panY = panelRect.height / 2 - nodeCenterY * state.zoom;
  applyGraphViewportTransform(container, side, state);
}

function buildGraphLayout(snapshot: PromptGraphSnapshot): {
  nodes: PromptNode[];
  width: number;
  height: number;
} {
  const needsAutoLayout = snapshot.nodes.some((node, index) => index > 0 && node.x < 12 && node.y < 12);
  const nodes = snapshot.nodes.map((node, index) => {
    if (!needsAutoLayout) return { ...node, meta: { ...node.meta } };
    const col = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    return {
      ...node,
      x: GRID_PAD + col * (NODE_WIDTH + GRID_GAP_X),
      y: GRID_PAD + row * (NODE_HEIGHT + GRID_GAP_Y),
      meta: { ...node.meta },
    };
  });

  if (nodes.length === 0) {
    return {
      nodes,
      width: 800,
      height: 560,
    };
  }

  let maxX = 0;
  let maxY = 0;
  for (const node of nodes) {
    maxX = Math.max(maxX, node.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.y + NODE_HEIGHT);
  }

  return {
    nodes,
    width: Math.max(900, Math.ceil(maxX + GRID_PAD)),
    height: Math.max(600, Math.ceil(maxY + GRID_PAD)),
  };
}

function diffGraphSnapshots(oldSnapshot: PromptGraphSnapshot, newSnapshot: PromptGraphSnapshot): GraphDiffResult {
  const oldMap = new Map(oldSnapshot.nodes.map((node) => [node.id, node] as const));
  const newMap = new Map(newSnapshot.nodes.map((node) => [node.id, node] as const));

  const oldAdj = adjacencyByNode(oldSnapshot.connections);
  const newAdj = adjacencyByNode(newSnapshot.connections);

  const allNodeIds = Array.from(new Set([...oldMap.keys(), ...newMap.keys()])).sort((left, right) => left.localeCompare(right));

  const oldStatusById = new Map<string, NodeDiffStatus>();
  const newStatusById = new Map<string, NodeDiffStatus>();
  const changedNodeIds: string[] = [];

  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  for (const id of allNodeIds) {
    const oldNode = oldMap.get(id);
    const newNode = newMap.get(id);

    if (!oldNode && newNode) {
      newStatusById.set(id, 'added');
      changedNodeIds.push(id);
      added += 1;
      continue;
    }

    if (oldNode && !newNode) {
      oldStatusById.set(id, 'removed');
      changedNodeIds.push(id);
      removed += 1;
      continue;
    }

    if (!oldNode || !newNode) {
      continue;
    }

    const oldSig = nodeSignature(oldNode, oldAdj.incoming.get(id) ?? [], oldAdj.outgoing.get(id) ?? []);
    const newSig = nodeSignature(newNode, newAdj.incoming.get(id) ?? [], newAdj.outgoing.get(id) ?? []);

    if (oldSig === newSig) {
      oldStatusById.set(id, 'unchanged');
      newStatusById.set(id, 'unchanged');
      unchanged += 1;
      continue;
    }

    oldStatusById.set(id, 'modified');
    newStatusById.set(id, 'modified');
    changedNodeIds.push(id);
    modified += 1;
  }

  return {
    oldStatusById,
    newStatusById,
    changedNodeIds,
    changedNodeIdSet: new Set(changedNodeIds),
    stats: { added, removed, modified, unchanged },
  };
}

function adjacencyByNode(connections: Connection[]): {
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
} {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const connection of connections) {
    const outgoingList = outgoing.get(connection.from) ?? [];
    outgoingList.push(connection.to);
    outgoing.set(connection.from, outgoingList);

    const incomingList = incoming.get(connection.to) ?? [];
    incomingList.push(connection.from);
    incoming.set(connection.to, incomingList);
  }

  for (const [nodeId, list] of incoming.entries()) {
    incoming.set(nodeId, [...list].sort());
  }
  for (const [nodeId, list] of outgoing.entries()) {
    outgoing.set(nodeId, [...list].sort());
  }

  return { incoming, outgoing };
}

function nodeSignature(node: PromptNode, incoming: string[], outgoing: string[]): string {
  const sortedMeta = Object.entries(node.meta).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    id: node.id,
    type: node.type,
    label: node.label,
    icon: node.icon,
    content: node.content,
    meta: sortedMeta,
    incoming,
    outgoing,
  });
}

function findNode(snapshot: PromptGraphSnapshot, nodeId: string): PromptNode | null {
  return snapshot.nodes.find((node) => node.id === nodeId) ?? null;
}

function formatNodeForDiff(node: PromptNode | null): string {
  if (!node) return '';

  const metadata = Object.entries(node.meta)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  return [
    `# ${node.label}`,
    `Type: ${node.type}`,
    `Icon: ${node.icon}`,
    metadata ? `\nMeta:\n${metadata}` : '',
    '\nContent:',
    node.content,
  ].filter(Boolean).join('\n');
}

function paletteForStatus(status: NodeDiffStatus): {
  container: string;
  headerBg: string;
  headerBorder: string;
  badge: string;
} {
  if (status === 'added') {
    return {
      container: 'border-emerald-400 bg-emerald-50/70 dark:bg-emerald-900/20',
      headerBg: 'bg-emerald-100/70 dark:bg-emerald-900/30',
      headerBorder: 'border-emerald-300/80 dark:border-emerald-700/80',
      badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    };
  }

  if (status === 'removed') {
    return {
      container: 'border-red-400 bg-red-50/70 dark:bg-red-900/20',
      headerBg: 'bg-red-100/70 dark:bg-red-900/30',
      headerBorder: 'border-red-300/80 dark:border-red-700/80',
      badge: 'bg-red-500/15 text-red-700 dark:text-red-300',
    };
  }

  if (status === 'modified') {
    return {
      container: 'border-amber-400 bg-amber-50/70 dark:bg-amber-900/20',
      headerBg: 'bg-amber-100/70 dark:bg-amber-900/30',
      headerBorder: 'border-amber-300/80 dark:border-amber-700/80',
      badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    };
  }

  return {
    container: 'border-primary/35 bg-white dark:bg-slate-900',
    headerBg: 'bg-primary/10 dark:bg-primary/20',
    headerBorder: 'border-primary/20 dark:border-primary/30',
    badge: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  };
}

function renderBanner(message: BannerMessage | null): string {
  if (!message) return '';

  if (message.tone === 'success') {
    return `<p class="mx-4 mt-3 rounded border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100 px-3 py-2 text-xs">${escapeHtml(message.text)}</p>`;
  }

  if (message.tone === 'info') {
    return `<p class="mx-4 mt-3 rounded border border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 px-3 py-2 text-xs">${escapeHtml(message.text)}</p>`;
  }

  return `<p class="mx-4 mt-3 rounded border border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100 px-3 py-2 text-xs">${escapeHtml(message.text)}</p>`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatVersionLabel(timestamp: number, notes: string): string {
  const note = notes.trim() || 'Snapshot';
  return `${formatDate(timestamp)} - ${note}`;
}

function defaultCommitMessage(projectName: string): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `Update ${projectName} prompt (${now} UTC)`;
}

function loadSidebarCollapsedState(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(DIFF_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistSidebarCollapsedState(collapsed: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    if (collapsed) {
      window.localStorage.setItem(DIFF_SIDEBAR_COLLAPSED_STORAGE_KEY, '1');
      return;
    }
    window.localStorage.removeItem(DIFF_SIDEBAR_COLLAPSED_STORAGE_KEY);
  } catch {
    // Ignore localStorage write failures.
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function trimForPreview(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 180) return normalized || '(empty)';
  return `${normalized.slice(0, 177)}...`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
