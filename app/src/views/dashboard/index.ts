/**
 * Dashboard View — Project card grid (matches page1.html mockup)
 */
import { store, type TranscriptFlowDraft } from '../../store';
import type { Project, PromptNode, Connection, Folder } from '../../models';
import { router } from '../../router';
import {
  deleteCurrentUserAccount,
  confirmCurrentPassword,
  getCurrentUser,
  getOnboardingProfile,
  sendPasswordResetEmail,
  signOut,
  updateCurrentUserPassword,
  updateCurrentUserProfile,
  type AccountProfileInput,
} from '../../auth';
import { themeToggleHTML, wireThemeToggle } from '../../theme';
import { clearProjectEscapeToCanvas } from '../project-nav';
import { customAlert, customConfirm, customPrompt } from '../../dialogs';
import { preserveScrollDuringRender } from '../../view-state';
import { getSubscriptionLimits, type SubscriptionLimits } from '../../subscription-limits';
import { getSubscription } from '../../billing';


import type {
  DashboardLayout,
  DashboardAccountState,
  MessageKind,
} from "./types";
import {
  DASHBOARD_LAYOUT_KEY,
  FOLDER_SIDEBAR_KEY,
  FOLDER_EXPANDED_KEY,
} from "./types";

export function renderDashboard(container: HTMLElement): void {
  preserveScrollDuringRender(container, () => {
    clearProjectEscapeToCanvas(container);
    const allFolders = store.getFolders();
    const selectedFolderId = getSelectedFolderId();
    const promptProjects = selectedFolderId === undefined
      ? store.getPromptFlowProjects()
      : store.getPromptFlowProjectsInFolder(selectedFolderId);
    const transcriptFlows = selectedFolderId === undefined
      ? store.getTranscriptFlowDrafts()
      : store.getTranscriptFlowDraftsInFolder(selectedFolderId);
    const sidebarCollapsed = localStorage.getItem(FOLDER_SIDEBAR_KEY) === 'collapsed';
    const selectedLabel = selectedFolderId === undefined
      ? 'All'
      : selectedFolderId === null
        ? 'Root (No Folder)'
        : store.getFolder(selectedFolderId)?.name ?? 'Folder';

    container.innerHTML = `
      <!-- Top Navigation Bar -->
      <nav class="sticky top-0 z-50 bg-white/80 dark:bg-background-dark/80 backdrop-blur-md border-b border-card-border dark:border-primary/20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="min-h-16 py-3 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <img src="${import.meta.env.BASE_URL}Spoqen-2.svg" alt="Spoqen" class="h-8 w-auto" />
          </div>
          <div class="hidden lg:flex flex-1 min-w-[16rem] max-w-md mx-4 xl:mx-8">
            <div class="relative w-full">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span class="material-icons-outlined text-slate-400 text-sm">search</span>
              </div>
              <input id="search-input" class="block w-full pl-10 pr-3 py-2 border border-card-border dark:border-primary/20 rounded-lg bg-background-light dark:bg-background-dark/50 text-sm placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" placeholder="Search projects by name or model..." type="text" />
            </div>
          </div>
          <div class="flex items-center gap-2 sm:gap-4 flex-wrap justify-end">
            ${themeToggleHTML()}
            <button class="p-2 text-slate-500 hover:text-primary transition-colors">
              <span class="material-icons-outlined">notifications</span>
            </button>
            <div id="dashboard-account-root" class="relative">
              <button
                id="dashboard-account-trigger"
                type="button"
                class="flex items-center gap-2 rounded-full border border-card-border dark:border-primary/20 px-1.5 py-1 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                aria-label="Open account menu"
                aria-haspopup="menu"
                aria-expanded="false"
                aria-controls="dashboard-account-menu"
              >
                <div id="dashboard-user-avatar" class="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center overflow-hidden" aria-label="Signed-in user avatar">
                  <span class="text-primary text-xs font-bold">U</span>
                </div>
                <span class="material-icons-outlined text-slate-500 text-[18px]">expand_more</span>
              </button>
              <div id="dashboard-account-menu" role="menu" class="hidden absolute right-0 mt-2 w-72 rounded-xl border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
                <div class="px-4 py-3 border-b border-card-border dark:border-primary/10">
                  <p id="dashboard-account-name" class="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">Account</p>
                  <p id="dashboard-account-email" class="text-xs text-slate-500 dark:text-slate-400 truncate">No email</p>
                </div>
                <div class="p-2">
                  <button id="btn-account-settings" type="button" role="menuitem" class="w-full text-left rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    Account settings
                  </button>
                  <button id="btn-billing" type="button" role="menuitem" class="w-full text-left rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    Billing
                  </button>
                  <button id="btn-sign-out" type="button" role="menuitem" class="w-full text-left rounded-lg px-3 py-2 text-sm text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>

    <div class="flex flex-1 min-h-0 max-w-7xl mx-auto w-full">
      <!-- Folder Sidebar -->
      <aside id="folder-sidebar" class="${sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-56 min-w-[14rem]'} transition-all duration-200 border-r border-card-border dark:border-primary/10 bg-white/50 dark:bg-slate-900/30 flex-shrink-0 flex flex-col">
        <div class="px-3 pt-4 pb-2 flex items-center justify-between gap-1">
          <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Folders</span>
          <div class="flex items-center gap-0.5">
            <button id="btn-new-folder" type="button" class="p-1 text-slate-400 hover:text-primary rounded transition-colors" title="New folder">
              <span class="material-icons-outlined text-[16px]">create_new_folder</span>
            </button>
            <button id="btn-collapse-sidebar" type="button" class="p-1 text-slate-400 hover:text-primary rounded transition-colors" title="Collapse sidebar">
              <span class="material-icons-outlined text-[16px]">chevron_left</span>
            </button>
          </div>
        </div>
        <nav class="flex-1 overflow-y-auto custom-scrollbar px-1.5 pb-4">
          <div class="flex items-center" style="padding-left:0px">
            <span class="w-5"></span>
            <button
              data-folder-id="__all__"
              class="folder-tree-item flex-1 text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${selectedFolderId === undefined ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}"
            >
              <span class="material-icons-outlined text-[16px]">folder_special</span>
              <span class="truncate">All Items</span>
            </button>
          </div>
          <div class="flex items-center" style="padding-left:0px">
            <span class="w-5"></span>
            <button
              data-folder-id="__root__"
              class="folder-tree-item flex-1 text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${selectedFolderId === null ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}"
            >
              <span class="material-icons-outlined text-[16px]">snippet_folder</span>
              <span class="truncate">Unfiled</span>
            </button>
          </div>
          ${renderFolderTree(allFolders, null, 0, selectedFolderId)}
        </nav>
      </aside>

      <!-- Main Content -->
      <main data-scroll-preserve="dashboard-main" class="flex-1 min-h-0 min-w-0 overflow-y-auto custom-scrollbar px-4 sm:px-6 lg:px-8 py-8">
        <!-- Sidebar toggle when collapsed -->
        ${sidebarCollapsed ? `
          <button id="btn-expand-sidebar" type="button" class="mb-4 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-primary border border-card-border dark:border-primary/20 rounded-lg transition-colors">
            <span class="material-icons-outlined text-[16px]">folder</span>
            <span>Show Folders</span>
          </button>
        ` : ''}

        <!-- Action Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 class="text-2xl font-bold text-slate-900 dark:text-white leading-tight">Project Dashboard</h1>
            <p class="text-neutral-gray dark:text-neutral-gray/80 text-sm mt-1">
              ${selectedFolderId === undefined ? 'Manage and orchestrate your node-based AI workflows.' : `Viewing: <strong>${escapeHtml(selectedLabel)}</strong>`}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 sm:justify-end">
            <div class="flex bg-white dark:bg-slate-800 border border-card-border dark:border-primary/20 rounded-lg p-1">
              <button id="btn-grid-view" type="button" aria-label="Grid view" aria-pressed="true" class="p-1 rounded-md transition-colors bg-primary/10 text-primary inline-flex items-center justify-center">
                <span class="material-icons-outlined text-[18px] leading-none">grid_view</span>
              </button>
              <button id="btn-list-view" type="button" aria-label="List view" aria-pressed="false" class="p-1 rounded-md transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center justify-center">
                <span class="material-icons-outlined text-[18px] leading-none">view_list</span>
              </button>
            </div>
            <button id="btn-import-prompt" class="ui-btn ui-btn-outline !text-sm !py-2">
              <span class="material-icons-outlined text-sm">file_upload</span>
              <span>Import Prompt</span>
            </button>
            <button id="btn-import-transcript" class="ui-btn ui-btn-outline !text-sm !py-2">
              <span class="material-icons-outlined text-sm">smart_toy</span>
              <span>Import Transcript</span>
            </button>
            <button id="btn-new-project" class="ui-btn ui-btn-primary !text-sm !py-2">
              <span class="material-icons-outlined text-sm">add</span>
              <span>New Project</span>
            </button>
          </div>
        </div>

        <section class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100 uppercase tracking-wide">Prompt Flows</h2>
            <span class="text-[11px] text-slate-400">${promptProjects.length} projects</span>
          </div>
          <div id="prompt-flow-grid" class="dashboard-project-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            ${promptProjects.map((project) => renderPromptFlowCard(project, allFolders)).join('')}

            <div id="new-project-card" class="new-project-card group border-2 border-dashed border-card-border dark:border-primary/20 rounded-xl transition-all duration-200 cursor-pointer hover:border-primary/50 hover:bg-primary/5 flex flex-col items-center justify-center min-h-[280px]">
              <div class="w-12 h-12 bg-slate-100 dark:bg-slate-800 group-hover:bg-primary group-hover:text-white rounded-full flex items-center justify-center text-slate-400 transition-colors mb-3">
                <span class="material-icons-outlined text-2xl">add_circle_outline</span>
              </div>
              <div class="new-project-card-copy flex flex-col items-center">
                <span class="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-primary">Create New Blueprint</span>
                <span class="text-[11px] text-slate-400 mt-1">Start from a blank canvas</span>
              </div>
            </div>
          </div>
        </section>

        <section class="space-y-3 mt-10">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-slate-800 dark:text-slate-100 uppercase tracking-wide">Transcript Flows</h2>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Persistent transcript projects with a unified open path into Canvas.</p>
            </div>
            <span class="text-[11px] text-slate-400">${transcriptFlows.length} transcript sets</span>
          </div>
          <div id="transcript-flow-grid" class="dashboard-project-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            ${transcriptFlows.map((flow) => renderTranscriptFlowCard(flow, allFolders)).join('')}

            <div id="new-transcript-flow-card" class="new-project-card group border-2 border-dashed border-card-border dark:border-primary/20 rounded-xl transition-all duration-200 cursor-pointer hover:border-primary/50 hover:bg-primary/5 flex flex-col items-center justify-center min-h-[280px]">
              <div class="w-12 h-12 bg-slate-100 dark:bg-slate-800 group-hover:bg-primary group-hover:text-white rounded-full flex items-center justify-center text-slate-400 transition-colors mb-3">
                <span class="material-icons-outlined text-2xl">add_circle_outline</span>
              </div>
              <div class="new-project-card-copy flex flex-col items-center">
                <span class="text-sm font-medium text-slate-600 dark:text-slate-300 group-hover:text-primary">Create New Transcript Flow</span>
                <span class="text-[11px] text-slate-400 mt-1">Start from a blank transcript flow</span>
              </div>
            </div>

            ${transcriptFlows.length === 0
          ? `
                <div class="col-span-full rounded-xl border border-dashed border-card-border dark:border-primary/20 bg-white/70 dark:bg-slate-900/50 px-5 py-6 text-sm text-slate-500 dark:text-slate-300">
                  No transcript flows yet. Use <strong>Import Transcript</strong> to auto-generate one.
                </div>
              `
          : ''}
          </div>
        </section>

        <!-- Footer -->
        <footer class="mt-16 pt-8 border-t border-card-border dark:border-primary/10 flex flex-col md:flex-row justify-between items-center text-[12px] text-slate-400 gap-4">
          <div class="flex items-center gap-6">
            <a class="hover:text-primary transition-colors" href="#">Documentation</a>
            <a class="hover:text-primary transition-colors" href="#">Templates</a>
            <a class="hover:text-primary transition-colors" href="#">API Keys</a>
          </div>
          <p>&copy; 2026 PromptBlueprint. All rights reserved.</p>
        </footer>
      </main>
    </div>

    <!-- New Project Modal -->
    <div id="new-project-modal" class="fixed inset-0 z-[999] hidden items-center justify-center bg-black/40 backdrop-blur-sm">
      <div class="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-card-border dark:border-primary/20 w-full max-w-md p-6">
        <h2 id="new-project-modal-title" class="text-lg font-bold">New Project</h2>
        <p id="new-project-modal-subtitle" class="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">Choose a flow type to continue.</p>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-2">Flow Type</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                id="modal-flow-card-prompt"
                type="button"
                data-flow-mode="prompt"
                data-active="false"
                class="modal-flow-card text-left rounded-xl border border-card-border dark:border-primary/20 p-3 bg-white dark:bg-slate-800/50"
              >
                <div class="flex items-center gap-2">
                  <span class="material-icons-outlined text-primary text-[20px]">account_tree</span>
                  <span class="text-sm font-semibold text-slate-800 dark:text-slate-100">Prompt Flow</span>
                </div>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Blueprint-style node flow from prompt design.</p>
              </button>
              <button
                id="modal-flow-card-transcript"
                type="button"
                data-flow-mode="transcript"
                data-active="false"
                class="modal-flow-card text-left rounded-xl border border-card-border dark:border-primary/20 p-3 bg-white dark:bg-slate-800/50"
              >
                <div class="flex items-center gap-2">
                  <span class="material-icons-outlined text-primary text-[20px]">smart_toy</span>
                  <span class="text-sm font-semibold text-slate-800 dark:text-slate-100">Transcript Flow</span>
                </div>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Flow built from transcripts and conversation patterns.</p>
              </button>
            </div>
          </div>
          <div id="modal-project-fields" class="space-y-4 hidden">
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">Project Name</label>
              <input id="modal-name" class="w-full border border-card-border dark:border-primary/20 rounded-lg px-3 py-2 text-sm bg-background-light dark:bg-background-dark focus:ring-1 focus:ring-primary outline-none" placeholder="My Voice Assistant" />
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">Description</label>
              <textarea id="modal-desc" rows="2" class="w-full border border-card-border dark:border-primary/20 rounded-lg px-3 py-2 text-sm bg-background-light dark:bg-background-dark focus:ring-1 focus:ring-primary outline-none" placeholder="Describe the purpose of this prompt..."></textarea>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">Target Model</label>
              <select id="modal-model" class="w-full border border-card-border dark:border-primary/20 rounded-lg px-3 py-2 text-sm bg-background-light dark:bg-background-dark focus:ring-1 focus:ring-primary outline-none">
                <option>GPT-4o</option>
                <option>Claude 3.5</option>
                <option>GPT-4 Turbo</option>
                <option>Llama 3</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">Folder (optional)</label>
              <select id="modal-folder" class="w-full border border-card-border dark:border-primary/20 rounded-lg px-3 py-2 text-sm bg-background-light dark:bg-background-dark focus:ring-1 focus:ring-primary outline-none">
                <option value="">No folder</option>
                ${renderFolderSelectOptions(allFolders, null, 0)}
              </select>
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-3 mt-6">
          <button id="modal-cancel" class="px-4 py-2 text-sm font-medium border border-card-border rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
          <button id="modal-create" class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">Create Project</button>
        </div>
      </div>
    </div>

    <div id="account-settings-modal" class="fixed inset-0 z-[1000] hidden items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div data-scroll-preserve="dashboard-account-modal" class="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-card-border dark:border-primary/20 w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div class="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Account settings</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Update your profile, manage password actions, or delete your account.</p>
          </div>
          <button id="account-modal-close" type="button" class="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Close account settings">
            <span class="material-icons-outlined">close</span>
          </button>
        </div>

        <p id="account-message" class="hidden mb-4 rounded-lg border px-3 py-2 text-xs"></p>

        <form id="account-settings-form" class="space-y-4" autocomplete="off">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label for="account-email" class="block text-xs font-medium text-slate-500 mb-1">Email</label>
              <input id="account-email" type="email" readonly class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-600 dark:text-slate-300" />
            </div>
            <div class="sm:col-span-2">
              <label for="account-full-name" class="block text-xs font-medium text-slate-500 mb-1">Full name</label>
              <input id="account-full-name" type="text" required class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>

          <div class="pt-3 border-t border-card-border dark:border-primary/10">
            <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Current plan</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Your current access level and billing status.</p>
            <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2">
                <div class="text-[11px] text-slate-500 dark:text-slate-400">Plan</div>
                <div id="account-plan-label" class="text-sm font-semibold text-slate-800 dark:text-slate-100">—</div>
              </div>
              <div class="rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2">
                <div class="text-[11px] text-slate-500 dark:text-slate-400">Details</div>
                <div id="account-plan-detail" class="text-sm text-slate-700 dark:text-slate-200">—</div>
              </div>
            </div>
          </div>

          <div class="pt-3 border-t border-card-border dark:border-primary/10">
            <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Password</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Set a new password now or send yourself a reset email.</p>
            <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label for="account-new-password" class="block text-xs font-medium text-slate-500 mb-1">New password</label>
                <input id="account-new-password" name="new-password" type="password" minlength="8" autocomplete="new-password" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label for="account-confirm-password" class="block text-xs font-medium text-slate-500 mb-1">Confirm password</label>
                <input id="account-confirm-password" name="confirm-password" type="password" minlength="8" autocomplete="new-password" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button id="account-update-password" type="button" class="rounded-lg border border-card-border dark:border-primary/20 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Update password</button>
              <button id="account-send-reset-email" type="button" class="rounded-lg border border-card-border dark:border-primary/20 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Send reset email</button>
            </div>
          </div>

          <div class="pt-3 border-t border-red-200 dark:border-red-900/40">
            <h3 class="text-sm font-semibold text-red-600 dark:text-red-300">Danger zone</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">This permanently deletes your account and all projects.</p>
            <div class="mt-3 flex flex-col sm:flex-row gap-3 sm:items-center">
              <input id="account-delete-password" name="current-password" type="password" autocomplete="current-password" placeholder="Enter current password to confirm" class="w-full sm:w-64 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-400" />
              <button id="account-delete-button" type="button" class="rounded-lg bg-red-600 text-white px-3 py-2 text-xs font-semibold hover:bg-red-700 transition-colors">Delete account</button>
            </div>
          </div>

          <div class="pt-2 flex justify-end gap-2">
            <button id="account-cancel-button" type="button" class="px-4 py-2 text-sm font-medium border border-card-border dark:border-primary/20 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button id="account-save-button" type="submit" class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">Save changes</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Decorative Element -->
    <div class="fixed bottom-0 right-0 p-8 opacity-20 pointer-events-none">
      <span class="material-icons-outlined text-9xl text-primary">scatter_plot</span>
    </div>
  `;

    // ── Event Wiring ──────────────────────
    // Click on project card → open canvas
    container.querySelectorAll<HTMLElement>('.prompt-project-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.delete-project,.rename-project,.move-to-folder-select')) return;
        const projectId = card.dataset.projectId;
        if (projectId) router.navigate(`/project/${projectId}`);
      });
    });

    const openTranscriptEntry = async (transcriptSetId: string, projectId: string | null): Promise<void> => {
      const normalizedProjectId = projectId?.trim() || null;
      if (normalizedProjectId && store.getProject(normalizedProjectId)) {
        router.navigate(`/project/${normalizedProjectId}`);
        return;
      }

      const linkedProject = store.createProjectFromTranscriptFlowDraft(transcriptSetId);
      if (linkedProject) {
        router.navigate(`/project/${linkedProject.id}`);
        return;
      }

      // Legacy fallback for transcript sets that do not have enough flow data to seed a project.
      router.navigate(`/import/transcript/${transcriptSetId}`);
    };

    container.querySelectorAll<HTMLElement>('.transcript-project-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.delete-transcript-flow,.rename-transcript-flow,.open-transcript-entry,.move-to-folder-select')) return;
        const transcriptSetId = card.dataset.transcriptSetId;
        if (!transcriptSetId) return;
        void openTranscriptEntry(transcriptSetId, card.dataset.projectId ?? null);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.open-transcript-entry').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const transcriptSetId = button.dataset.transcriptSetId;
        if (!transcriptSetId) return;
        void openTranscriptEntry(transcriptSetId, button.dataset.projectId ?? null);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.rename-project').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const projectId = btn.dataset.id;
        if (!projectId) return;
        const currentName = btn.dataset.name ?? '';
        void (async () => {
          const newName = await customPrompt('Rename project:', currentName);
          if (newName !== null && newName.trim()) {
            store.renameProject(projectId, newName.trim());
            renderDashboard(container);
          }
        })();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.rename-transcript-flow').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const transcriptSetId = btn.dataset.transcriptSetId;
        if (!transcriptSetId) return;
        const currentName = btn.dataset.name ?? '';
        void (async () => {
          const newName = await customPrompt('Rename transcript flow:', currentName);
          if (newName !== null && newName.trim()) {
            store.renameTranscriptSet(transcriptSetId, newName.trim());
            renderDashboard(container);
          }
        })();
      });
    });

    container.querySelectorAll<HTMLElement>('.delete-project').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const projectId = button.dataset.id;
        if (!projectId) return;
        const limits = await loadLimits();
        if (limits.isFreeTier) {
          await customAlert('Deleting prompt flows is disabled on the free tier. Upgrade to Pro to manage flows without limits.');
          return;
        }
        if (!(await customConfirm('Delete this project?'))) return;
        store.deleteProject(projectId);
        renderDashboard(container);
      });
    });

    container.querySelectorAll<HTMLElement>('.delete-transcript-flow').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const transcriptSetId = button.dataset.transcriptSetId;
        if (!transcriptSetId) return;
        const limits = await loadLimits();
        if (limits.isFreeTier) {
          await customAlert('Deleting transcript flows is disabled on the free tier. Upgrade to Pro to manage flows without limits.');
          return;
        }
        const linkedProjectId = button.dataset.projectId;
        const confirmText = linkedProjectId
          ? 'Delete this transcript flow and its linked project?'
          : 'Delete this transcript flow?';
        if (!(await customConfirm(confirmText))) return;
        store.deleteTranscriptFlow(transcriptSetId);
        renderDashboard(container);
      });
    });

    // New project modal
    const modal = container.querySelector<HTMLElement>('#new-project-modal')!;
    const modalTitle = container.querySelector<HTMLElement>('#new-project-modal-title');
    const modalSubtitle = container.querySelector<HTMLElement>('#new-project-modal-subtitle');
    const modalFlowCards = Array.from(container.querySelectorAll<HTMLButtonElement>('.modal-flow-card'));
    const modalFields = container.querySelector<HTMLElement>('#modal-project-fields');
    const modalCreateButton = container.querySelector<HTMLButtonElement>('#modal-create');
    let modalMode: 'prompt' | 'transcript' | null = null;

    const setModalMode = (mode: 'prompt' | 'transcript' | null): void => {
      modalMode = mode;
      modalFlowCards.forEach((card) => {
        card.dataset.active = String(card.dataset.flowMode === mode);
      });
      if (modalFields) {
        modalFields.classList.toggle('hidden', mode === null);
      }
      const nameInput = container.querySelector<HTMLInputElement>('#modal-name');
      const descInput = container.querySelector<HTMLTextAreaElement>('#modal-desc');
      if (mode === null) {
        if (modalTitle) modalTitle.textContent = 'New Project';
        if (modalSubtitle) modalSubtitle.textContent = 'Choose a flow type to continue.';
        if (modalCreateButton) {
          modalCreateButton.textContent = 'Create Project';
          modalCreateButton.disabled = true;
        }
        if (nameInput) {
          nameInput.placeholder = 'Project Name';
        }
        if (descInput) {
          descInput.placeholder = 'Describe this project...';
        }
        return;
      }

      if (modalCreateButton) {
        modalCreateButton.disabled = false;
      }

      if (mode === 'transcript') {
        if (modalTitle) modalTitle.textContent = 'New Transcript Flow';
        if (modalSubtitle) modalSubtitle.textContent = 'Create a standalone transcript flow project you can edit in Canvas.';
        if (modalCreateButton) modalCreateButton.textContent = 'Create Transcript Flow';
        if (nameInput) {
          nameInput.placeholder = 'Customer Support Transcript Flow';
        }
        if (descInput) {
          descInput.placeholder = 'Describe this transcript flow workspace...';
        }
        return;
      }

      if (modalTitle) modalTitle.textContent = 'New Project';
      if (modalSubtitle) modalSubtitle.textContent = 'Create a prompt flow project.';
      if (modalCreateButton) modalCreateButton.textContent = 'Create Project';
      if (nameInput) {
        nameInput.placeholder = 'My Voice Assistant';
      }
      if (descInput) {
        descInput.placeholder = 'Describe the purpose of this prompt...';
      }
    };

    const openModal = () => { modal.classList.remove('hidden'); modal.classList.add('flex'); };
    const closeModal = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };
    const openNewProjectModal = () => {
      setModalMode(null);
      openModal();
    };
    const openPromptModal = () => {
      setModalMode('prompt');
      openModal();
    };
    const openTranscriptModal = () => {
      setModalMode('transcript');
      openModal();
    };
    setModalMode(null);
    modalFlowCards.forEach((card) => {
      card.addEventListener('click', () => {
        setModalMode(card.dataset.flowMode === 'transcript' ? 'transcript' : 'prompt');
      });
    });

    let cachedLimits: SubscriptionLimits | null = null;
    const loadLimits = async (): Promise<SubscriptionLimits> => {
      if (!cachedLimits) cachedLimits = await getSubscriptionLimits();
      return cachedLimits;
    };

    const importPromptBtn = container.querySelector<HTMLButtonElement>('#btn-import-prompt');
    const importTranscriptBtn = container.querySelector<HTMLButtonElement>('#btn-import-transcript');

    importPromptBtn?.addEventListener('click', () => {
      void (async () => {
        const limits = await loadLimits();
        if (limits.isFreeTier && !limits.canUseImportPrompt) {
          await customAlert('You have already used Import Prompt on the free tier. Upgrade to Pro for unlimited imports.');
          return;
        }
        if (limits.isFreeTier && !limits.canCreatePromptFlow) {
          await customAlert(`You've reached the limit of ${limits.promptFlowLimit} prompt flows on the free tier. Upgrade to Pro for unlimited flows.`);
          return;
        }
        router.navigate('/import');
      })();
    });

    importTranscriptBtn?.addEventListener('click', () => {
      void (async () => {
        const limits = await loadLimits();
        if (limits.isFreeTier && !limits.canUseImportTranscript) {
          await customAlert('You have already used Import Transcript on the free tier. Upgrade to Pro for unlimited imports.');
          return;
        }
        if (limits.isFreeTier && !limits.canCreateTranscriptionFlow) {
          await customAlert(`You've reached the limit of ${limits.transcriptionFlowLimit} transcript flows on the free tier. Upgrade to Pro for unlimited flows.`);
          return;
        }
        if (limits.isFreeTier && !limits.canCreateTranscriptSet) {
          await customAlert(`You've reached the limit of ${limits.transcriptSetLimit} transcript sets on the free tier. Upgrade to Pro for unlimited transcript sets.`);
          return;
        }
        router.navigate('/import/transcript');
      })();
    });

    container.querySelector('#btn-new-project')?.addEventListener('click', openNewProjectModal);
    container.querySelector('#new-project-card')?.addEventListener('click', openPromptModal);
    container.querySelector('#new-transcript-flow-card')?.addEventListener('click', openTranscriptModal);
    container.querySelector('#modal-cancel')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    container.querySelector('#modal-create')?.addEventListener('click', () => {
      void (async () => {
        const createButton = container.querySelector<HTMLButtonElement>('#modal-create');
        if (createButton) createButton.disabled = true;

        try {
          if (!modalMode) {
            await customAlert('Select Prompt Flow or Transcript Flow first.');
            return;
          }

          const limits = await loadLimits();
          if (modalMode === 'prompt' && limits.isFreeTier && !limits.canCreatePromptFlow) {
            await customAlert(`You've reached the limit of ${limits.promptFlowLimit} prompt flows on the free tier. Upgrade to Pro for unlimited flows.`);
            return;
          }
          if (modalMode === 'transcript' && limits.isFreeTier && !limits.canCreateTranscriptionFlow) {
            await customAlert(`You've reached the limit of ${limits.transcriptionFlowLimit} transcript flows on the free tier. Upgrade to Pro for unlimited flows.`);
            return;
          }
          if (modalMode === 'transcript' && limits.isFreeTier && !limits.canCreateTranscriptSet) {
            await customAlert(`You've reached the limit of ${limits.transcriptSetLimit} transcript sets on the free tier. Upgrade to Pro for unlimited transcript sets.`);
            return;
          }

          const name = (container.querySelector('#modal-name') as HTMLInputElement).value.trim();
          const desc = (container.querySelector('#modal-desc') as HTMLTextAreaElement).value.trim();
          const model = (container.querySelector('#modal-model') as HTMLSelectElement).value;
          const folderSelect = container.querySelector<HTMLSelectElement>('#modal-folder');
          const folderId = folderSelect?.value || null;
          const project = modalMode === 'transcript'
            ? await store.createTranscriptFlowProject(name || 'Untitled Transcript Flow', desc, model, folderId)
            : store.createProject(name || 'Untitled Blueprint', desc, model, folderId);
          cachedLimits = null;
          closeModal();
          router.navigate(`/project/${project.id}`);
        } catch (err) {
          console.error('Failed to create project:', err);
          await customAlert(err instanceof Error ? err.message : 'Unable to create project.');
        } finally {
          if (createButton) createButton.disabled = false;
        }
      })();
    });

    // Folder sidebar events
    container.querySelectorAll<HTMLButtonElement>('.folder-tree-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rawId = btn.dataset.folderId ?? '';
        if (rawId === '__all__') {
          setSelectedFolderId(undefined);
        } else if (rawId === '__root__') {
          setSelectedFolderId(null);
        } else {
          setSelectedFolderId(rawId);
        }
        renderDashboard(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.folder-tree-toggle').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderId = btn.dataset.folderId;
        if (folderId) toggleFolderExpanded(folderId);
        renderDashboard(container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.folder-rename').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderId = btn.dataset.folderId;
        if (!folderId) return;
        const folder = store.getFolder(folderId);
        void (async () => {
          const newName = await customPrompt('Rename folder:', folder?.name ?? '');
          if (newName !== null && newName.trim()) {
            store.renameFolder(folderId, newName.trim());
            renderDashboard(container);
          }
        })();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.folder-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const folderId = btn.dataset.folderId;
        if (!folderId) return;
        void (async () => {
          if (await customConfirm('Delete this folder? Items inside will be moved to root.')) {
            store.deleteFolder(folderId);
            if (getSelectedFolderId() === folderId) setSelectedFolderId(undefined);
            renderDashboard(container);
          }
        })();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.folder-add-child').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parentId = btn.dataset.folderId ?? null;
        void (async () => {
          const name = await customPrompt('New folder name:');
          if (name !== null && name.trim()) {
            store.createFolder(name.trim(), parentId);
            if (parentId) setFolderExpanded(parentId, true);
            renderDashboard(container);
          }
        })();
      });
    });

    container.querySelector('#btn-new-folder')?.addEventListener('click', () => {
      const activeFolder = getSelectedFolderId();
      const parentId = activeFolder === undefined ? null : activeFolder;
      void (async () => {
        const name = await customPrompt('New folder name:');
        if (name !== null && name.trim()) {
          store.createFolder(name.trim(), parentId);
          if (parentId) setFolderExpanded(parentId, true);
          renderDashboard(container);
        }
      })();
    });

    container.querySelector('#btn-collapse-sidebar')?.addEventListener('click', () => {
      localStorage.setItem(FOLDER_SIDEBAR_KEY, 'collapsed');
      renderDashboard(container);
    });

    container.querySelector('#btn-expand-sidebar')?.addEventListener('click', () => {
      localStorage.removeItem(FOLDER_SIDEBAR_KEY);
      renderDashboard(container);
    });

    // Move-to-folder dropdown events
    container.querySelectorAll<HTMLSelectElement>('.move-to-folder-select').forEach((select) => {
      select.addEventListener('change', (e) => {
        e.stopPropagation();
        const projectId = select.dataset.projectId;
        const transcriptSetId = select.dataset.transcriptSetId;
        const targetFolderId = select.value || null;
        if (projectId) {
          store.moveProjectToFolder(projectId, targetFolderId);
        } else if (transcriptSetId) {
          store.moveTranscriptSetToFolder(transcriptSetId, targetFolderId);
        }
        renderDashboard(container);
      });
    });

    // Dashboard layout toggle (grid/list)
    const grids = Array.from(container.querySelectorAll<HTMLElement>('.dashboard-project-grid'));
    const gridBtn = container.querySelector<HTMLButtonElement>('#btn-grid-view');
    const listBtn = container.querySelector<HTMLButtonElement>('#btn-list-view');

    const setViewButtonState = (button: HTMLButtonElement, active: boolean): void => {
      button.classList.toggle('bg-primary/10', active);
      button.classList.toggle('text-primary', active);
      button.classList.toggle('text-slate-400', !active);
      button.classList.toggle('hover:text-slate-600', !active);
      button.classList.toggle('dark:hover:text-slate-200', !active);
      button.setAttribute('aria-pressed', String(active));
    };

    const applyLayout = (layout: DashboardLayout): void => {
      if (grids.length === 0 || !gridBtn || !listBtn) return;
      const listView = layout === 'list';
      grids.forEach((grid) => {
        grid.classList.toggle('dashboard-list-view', listView);
      });
      setViewButtonState(gridBtn, !listView);
      setViewButtonState(listBtn, listView);
      localStorage.setItem(DASHBOARD_LAYOUT_KEY, layout);
    };

    if (grids.length > 0 && gridBtn && listBtn) {
      const savedLayout = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
      const initialLayout: DashboardLayout = savedLayout === 'list' ? 'list' : 'grid';
      gridBtn.addEventListener('click', () => applyLayout('grid'));
      listBtn.addEventListener('click', () => applyLayout('list'));
      applyLayout(initialLayout);
    }

    // Search filter
    const searchInput = container.querySelector<HTMLInputElement>('#search-input');
    searchInput?.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      container.querySelectorAll<HTMLElement>('.dashboard-search-card').forEach(card => {
        const text = card.textContent?.toLowerCase() ?? '';
        card.style.display = text.includes(q) ? '' : 'none';
      });
    });

    // -- Drag-and-drop: cards/folders → sidebar folder targets --
    const DROP_HOVER_CLASSES = ['ring-1', 'ring-primary/40', 'bg-primary/5'];
    let currentDrag: { kind: 'project' | 'transcriptSet' | 'folder'; id: string } | null = null;

    container.querySelectorAll<HTMLElement>('[draggable="true"][data-drag-kind]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        const kind = el.dataset.dragKind as 'project' | 'transcriptSet' | 'folder' | undefined;
        const id = el.dataset.dragId;
        if (!kind || !id) return;
        currentDrag = { kind, id };
        e.dataTransfer?.setData('text/plain', JSON.stringify(currentDrag));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        el.classList.add('opacity-50');
      });
      el.addEventListener('dragend', () => {
        currentDrag = null;
        el.classList.remove('opacity-50');
        container.querySelectorAll('.drop-hover-active').forEach((t) => {
          DROP_HOVER_CLASSES.forEach((c) => t.classList.remove(c));
          t.classList.remove('drop-hover-active');
        });
      });
    });

    container.querySelectorAll<HTMLElement>('.folder-tree-item').forEach((target) => {
      target.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (!target.classList.contains('drop-hover-active')) {
          DROP_HOVER_CLASSES.forEach((c) => target.classList.add(c));
          target.classList.add('drop-hover-active');
        }
      });
      target.addEventListener('dragleave', () => {
        DROP_HOVER_CLASSES.forEach((c) => target.classList.remove(c));
        target.classList.remove('drop-hover-active');
      });
      target.addEventListener('drop', (e) => {
        e.preventDefault();
        DROP_HOVER_CLASSES.forEach((c) => target.classList.remove(c));
        target.classList.remove('drop-hover-active');
        if (!currentDrag) return;
        const rawTargetId = target.dataset.folderId ?? '';
        const isRootTarget = rawTargetId === '__root__' || rawTargetId === '__all__';
        const targetFolderId = isRootTarget ? null : rawTargetId || null;

        if (currentDrag.kind === 'project') {
          store.moveProjectToFolder(currentDrag.id, targetFolderId);
        } else if (currentDrag.kind === 'transcriptSet') {
          store.moveTranscriptSetToFolder(currentDrag.id, targetFolderId);
        } else if (currentDrag.kind === 'folder') {
          if (currentDrag.id === targetFolderId) return;
          store.moveFolder(currentDrag.id, targetFolderId);
        }
        currentDrag = null;
        renderDashboard(container);
      });
    });

    // Theme toggle
    wireThemeToggle(container);
    wireDashboardAccountInteractions(container);
    void hydrateDashboardAccount(container);

    void (async () => {
      try {
        const limits = await loadLimits();
        applyLimitBadges(container, limits);
      } catch {
        // Limits unavailable — leave buttons enabled
      }
    })();
  });
}

function applyLimitBadges(container: HTMLElement, limits: SubscriptionLimits): void {
  if (!limits.isFreeTier) return;

  const upgradeTag = '<span class="ml-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">(Upgrade)</span>';

  const importPromptBtn = container.querySelector<HTMLButtonElement>('#btn-import-prompt');
  if (importPromptBtn && (!limits.canUseImportPrompt || !limits.canCreatePromptFlow)) {
    importPromptBtn.classList.add('opacity-60');
    importPromptBtn.insertAdjacentHTML('beforeend', upgradeTag);
  }

  const importTranscriptBtn = container.querySelector<HTMLButtonElement>('#btn-import-transcript');
  if (importTranscriptBtn && (!limits.canUseImportTranscript || !limits.canCreateTranscriptionFlow || !limits.canCreateTranscriptSet)) {
    importTranscriptBtn.classList.add('opacity-60');
    importTranscriptBtn.insertAdjacentHTML('beforeend', upgradeTag);
  }

  const promptFlowCountEl = container.querySelector('#prompt-flow-grid')?.previousElementSibling?.querySelector('span:last-child');
  if (promptFlowCountEl) {
    promptFlowCountEl.textContent = `${limits.promptFlowCount} / ${limits.promptFlowLimit} projects`;
  }

  const transcriptFlowCountEl = container.querySelector('#transcript-flow-grid')?.previousElementSibling?.querySelector('.flex > span:last-child');
  if (transcriptFlowCountEl) {
    transcriptFlowCountEl.textContent = `${limits.transcriptSetCount} / ${limits.transcriptSetLimit} transcript sets`;
  }
}

function renderPromptFlowCard(project: Project, folders: Folder[]): string {
  const thumbnailHtml = generateGraphThumbnailSVG(project.nodes, project.connections, project.icon);
  const folderName = project.folderId ? store.getFolder(project.folderId)?.name : null;

  return `
    <div class="dashboard-search-card prompt-project-card project-card group bg-white dark:bg-slate-800/50 border border-card-border dark:border-primary/10 rounded-xl transition-all duration-200 cursor-pointer overflow-hidden flex flex-col" draggable="true" data-drag-kind="project" data-drag-id="${escapeHtml(project.id)}" data-project-id="${escapeHtml(project.id)}">
      <div class="project-card-hero h-32 bg-slate-50 dark:bg-slate-900/50 relative overflow-hidden flex items-center justify-center border-b border-card-border dark:border-primary/5">
        <div class="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity" style="background-image: radial-gradient(#23956F 1.5px, transparent 1.5px); background-size: 12px 12px;"></div>
        ${thumbnailHtml}
      </div>
      <div class="project-card-body p-5 flex-1 flex flex-col">
        <div class="flex justify-between items-start mb-2 gap-2">
          <h3 class="font-semibold text-slate-800 dark:text-slate-100 group-hover:text-primary transition-colors">${escapeHtml(project.name)}</h3>
          <div class="flex items-center gap-0.5 shrink-0">
            <button class="rename-project text-slate-400 hover:text-primary shrink-0" data-id="${escapeHtml(project.id)}" data-name="${escapeHtml(project.name)}" title="Rename project">
              <span class="material-icons-outlined text-[16px]">edit</span>
            </button>
            <button class="delete-project text-slate-400 hover:text-red-500 dark:hover:text-red-400 shrink-0" data-id="${escapeHtml(project.id)}" title="Delete project">
              <span class="material-icons-outlined text-lg">delete_outline</span>
            </button>
          </div>
        </div>
        <p class="project-description text-sm text-neutral-gray dark:text-neutral-gray/80 line-clamp-2 mb-4">${escapeHtml(project.description)}</p>
        <div class="mt-auto">
          <div class="flex items-center gap-2 mb-3">
            <span class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider rounded border border-primary/20">${escapeHtml(project.model)}</span>
            <span class="text-[11px] text-slate-400 flex items-center gap-1">
              <span class="material-icons-outlined text-[14px]">history</span>
              ${escapeHtml(project.lastEdited)}
            </span>
          </div>
          <div class="flex items-center justify-between gap-2">
            ${folderName ? `<span class="text-[10px] text-slate-400 flex items-center gap-1 truncate"><span class="material-icons-outlined text-[12px]">folder</span>${escapeHtml(folderName)}</span>` : '<span></span>'}
            <select
              class="move-to-folder-select text-[10px] text-slate-400 bg-transparent border border-card-border dark:border-primary/20 rounded px-1 py-0.5 cursor-pointer focus:ring-1 focus:ring-primary outline-none"
              data-project-id="${escapeHtml(project.id)}"
              title="Move to folder"
            >
              <option value="" ${!project.folderId ? 'selected' : ''}>No folder</option>
              ${renderFolderSelectOptions(folders, project.folderId, 0)}
            </select>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTranscriptFlowCard(flow: TranscriptFlowDraft, folders: Folder[]): string {
  const linkedProject = flow.projectId ? store.getProject(flow.projectId) ?? null : null;
  const linkedProjectId = linkedProject?.id ?? null;
  const latestFlow = flow.latestFlow;
  const model = linkedProject?.model || latestFlow?.model || 'unknown';
  const flowTitle = linkedProject?.name || latestFlow?.flowTitle || flow.name.replace(/\s+Transcript Set$/, '') || 'Transcript Flow';
  const flowSummary = linkedProject?.description || latestFlow?.flowSummary || flow.description || 'Stored transcript flow mapping.';
  const nodeCount = linkedProject?.nodes.length ?? latestFlow?.nodeCount ?? 0;
  const connectionCount = linkedProject?.connections.length ?? latestFlow?.connectionCount ?? 0;
  const updatedAt = linkedProject?.lastEdited || latestFlow?.createdAt || flow.updatedAt;
  const folderName = flow.folderId ? store.getFolder(flow.folderId)?.name : null;

  const thumbnailHtml = generateGraphThumbnailSVG(linkedProject?.nodes, linkedProject?.connections, 'smart_toy');

  return `
    <div class="dashboard-search-card transcript-project-card cursor-pointer project-card group bg-white dark:bg-slate-800/50 border border-card-border dark:border-primary/10 rounded-xl transition-all duration-200 overflow-hidden flex flex-col"
      draggable="true" data-drag-kind="transcriptSet" data-drag-id="${escapeHtml(flow.transcriptSetId)}"
      data-project-id="${linkedProjectId ? escapeHtml(linkedProjectId) : ''}"
      data-transcript-set-id="${escapeHtml(flow.transcriptSetId)}">
      <div class="project-card-hero h-32 bg-slate-50 dark:bg-slate-900/50 relative overflow-hidden flex items-center justify-center border-b border-card-border dark:border-primary/5">
        <div class="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity" style="background-image: radial-gradient(#23956F 1.5px, transparent 1.5px); background-size: 12px 12px;"></div>
        ${thumbnailHtml}
      </div>
      <div class="project-card-body p-5 flex-1 flex flex-col">
        <div class="flex items-start justify-between gap-2 mb-2">
          <h3 class="font-semibold text-slate-800 dark:text-slate-100 group-hover:text-primary transition-colors">${escapeHtml(flowTitle)}</h3>
          <div class="flex items-center gap-0.5 shrink-0">
            <button class="rename-transcript-flow text-slate-400 hover:text-primary shrink-0" data-transcript-set-id="${escapeHtml(flow.transcriptSetId)}" data-name="${escapeHtml(flowTitle)}" title="Rename transcript flow">
              <span class="material-icons-outlined text-[16px]">edit</span>
            </button>
            <button class="delete-transcript-flow text-slate-400 hover:text-red-500 dark:hover:text-red-400 shrink-0" data-transcript-set-id="${escapeHtml(flow.transcriptSetId)}" data-project-id="${linkedProjectId ? escapeHtml(linkedProjectId) : ''}" title="Delete transcript flow">
              <span class="material-icons-outlined text-lg">delete_outline</span>
            </button>
          </div>
        </div>
        <p class="project-description text-sm text-neutral-gray dark:text-neutral-gray/80 line-clamp-2 mb-4">${escapeHtml(flowSummary)}</p>
        <div class="mt-auto space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider rounded border border-primary/20">${escapeHtml(model)}</span>
            <span class="text-[11px] text-slate-400 flex items-center gap-1">
              <span class="material-icons-outlined text-[14px]">account_tree</span>
              ${nodeCount} nodes · ${connectionCount} edges
            </span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] text-slate-400">Updated ${escapeHtml(formatDashboardTimestamp(updatedAt))}</span>
            <div class="flex items-center gap-1.5">
              <button
                class="open-transcript-entry px-2.5 py-1 text-[11px] font-medium bg-primary text-white hover:bg-primary/90 rounded transition-colors"
                data-transcript-set-id="${escapeHtml(flow.transcriptSetId)}"
                data-project-id="${linkedProjectId ? escapeHtml(linkedProjectId) : ''}"
              >
                Open
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between gap-2">
            ${folderName ? `<span class="text-[10px] text-slate-400 flex items-center gap-1 truncate"><span class="material-icons-outlined text-[12px]">folder</span>${escapeHtml(folderName)}</span>` : '<span></span>'}
            <select
              class="move-to-folder-select text-[10px] text-slate-400 bg-transparent border border-card-border dark:border-primary/20 rounded px-1 py-0.5 cursor-pointer focus:ring-1 focus:ring-primary outline-none"
              data-transcript-set-id="${escapeHtml(flow.transcriptSetId)}"
              title="Move to folder"
            >
              <option value="" ${!flow.folderId ? 'selected' : ''}>No folder</option>
              ${renderFolderSelectOptions(folders, flow.folderId, 0)}
            </select>
          </div>
        </div>
      </div>
    </div>
  `;
}

function generateGraphThumbnailSVG(
  nodes: Pick<PromptNode, 'id' | 'x' | 'y'>[] | undefined,
  connections: Pick<Connection, 'from' | 'to'>[] | undefined,
  defaultIcon: string
): string {
  if (!nodes || nodes.length === 0) {
    return `<span class="material-icons-outlined text-slate-300 dark:text-slate-700 text-5xl">${escapeHtml(defaultIcon)}</span>`;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const NODE_WIDTH = 250;
  const NODE_HEIGHT = 80;

  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + NODE_WIDTH > maxX) maxX = n.x + NODE_WIDTH;
    if (n.y + NODE_HEIGHT > maxY) maxY = n.y + NODE_HEIGHT;
  }

  const paddingX = 60;
  const paddingY = 60;
  minX -= paddingX;
  minY -= paddingY;
  maxX += paddingX;
  maxY += paddingY;

  const width = Math.max(maxX - minX, 200);
  const height = Math.max(maxY - minY, 150);

  let paths = '';
  if (connections) {
    for (const conn of connections) {
      const fromNode = nodes.find(n => n.id === conn.from);
      const toNode = nodes.find(n => n.id === conn.to);
      if (!fromNode || !toNode) continue;

      const fx = fromNode.x + NODE_WIDTH;
      const fy = fromNode.y + NODE_HEIGHT / 2;
      const tx = toNode.x;
      const ty = toNode.y + NODE_HEIGHT / 2;

      const dist = Math.abs(tx - fx);
      // Determine control points based on x-distance (approx curve)
      const ctrlOffset = Math.max(40, dist * 0.4);
      const cpX1 = fx + ctrlOffset;
      const cpX2 = tx - ctrlOffset;

      paths += `<path d="M ${fx} ${fy} C ${cpX1} ${fy}, ${cpX2} ${ty}, ${tx} ${ty}" fill="none" stroke="currentColor" stroke-width="6" class="text-slate-300 dark:text-slate-600 opacity-60" />`;
    }
  }

  let rects = '';
  for (const n of nodes) {
    rects += `
      <g transform="translate(${n.x}, ${n.y})">
        <rect x="0" y="0" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="12" fill="currentColor" stroke="currentColor" stroke-width="4" class="text-white dark:text-slate-800 fill-white dark:fill-slate-800 stroke-slate-200 dark:stroke-slate-700" />
        <rect x="16" y="24" width="32" height="32" rx="8" fill="currentColor" class="text-slate-200 dark:text-slate-700" />
        <rect x="64" y="30" width="120" height="8" rx="4" fill="currentColor" class="text-slate-200 dark:text-slate-600 opacity-80" />
        <rect x="64" y="46" width="80" height="6" rx="3" fill="currentColor" class="text-slate-200 dark:text-slate-600 opacity-80" />
      </g>
    `;
  }

  return `
    <div class="absolute inset-0 w-full h-full flex items-center justify-center p-4">
      <svg viewBox="${minX} ${minY} ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="w-full h-full object-contain opacity-70 group-hover:opacity-100 transition-opacity drop-shadow-sm" preserveAspectRatio="xMidYMid meet">
        ${paths}
        ${rects}
      </svg>
    </div>
  `;
}

/* Folder state helpers */

const SELECTED_FOLDER_KEY = 'promptblueprint_selected_folder';

function getSelectedFolderId(): string | null | undefined {
  const stored = sessionStorage.getItem(SELECTED_FOLDER_KEY);
  if (stored === null) return undefined;
  if (stored === '__root__') return null;
  return stored;
}

function setSelectedFolderId(value: string | null | undefined): void {
  if (value === undefined) {
    sessionStorage.removeItem(SELECTED_FOLDER_KEY);
  } else if (value === null) {
    sessionStorage.setItem(SELECTED_FOLDER_KEY, '__root__');
  } else {
    sessionStorage.setItem(SELECTED_FOLDER_KEY, value);
  }
}

function getExpandedFolderIds(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLDER_EXPANDED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function setFolderExpanded(id: string, expanded: boolean): void {
  const set = getExpandedFolderIds();
  if (expanded) set.add(id); else set.delete(id);
  localStorage.setItem(FOLDER_EXPANDED_KEY, JSON.stringify([...set]));
}

function toggleFolderExpanded(id: string): void {
  const set = getExpandedFolderIds();
  if (set.has(id)) set.delete(id); else set.add(id);
  localStorage.setItem(FOLDER_EXPANDED_KEY, JSON.stringify([...set]));
}

function buildFolderChildren(folders: Folder[]): Map<string | null, Folder[]> {
  const map = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const key = f.parentId;
    const list = map.get(key);
    if (list) list.push(f);
    else map.set(key, [f]);
  }
  return map;
}

function renderFolderTree(
  folders: Folder[],
  parentId: string | null,
  depth: number,
  selectedFolderId: string | null | undefined,
): string {
  const childrenMap = buildFolderChildren(folders);
  const expanded = getExpandedFolderIds();

  function renderLevel(parentKey: string | null, level: number): string {
    const children = childrenMap.get(parentKey) ?? [];
    if (children.length === 0) return '';

    return children.map((folder) => {
      const hasChildren = (childrenMap.get(folder.id) ?? []).length > 0;
      const isExpanded = expanded.has(folder.id);
      const isSelected = selectedFolderId === folder.id;
      const indent = level * 12;
      const chevron = hasChildren
        ? `<button class="folder-tree-toggle p-0.5 text-slate-400 hover:text-primary rounded transition-colors" data-folder-id="${escapeHtml(folder.id)}"><span class="material-icons-outlined text-[14px]">${isExpanded ? 'expand_more' : 'chevron_right'}</span></button>`
        : '<span class="w-5"></span>';

      return `
        <div class="flex items-center group/folder" style="padding-left:${indent}px">
          ${chevron}
          <button
            data-folder-id="${escapeHtml(folder.id)}"
            draggable="true" data-drag-kind="folder" data-drag-id="${escapeHtml(folder.id)}"
            class="folder-tree-item flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-colors truncate ${isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}"
          >
            <span class="material-icons-outlined text-[16px]">${isExpanded ? 'folder_open' : 'folder'}</span>
            <span class="truncate">${escapeHtml(folder.name)}</span>
          </button>
          <div class="hidden group-hover/folder:flex items-center gap-0.5 shrink-0 pr-1">
            <button class="folder-add-child p-0.5 text-slate-400 hover:text-primary rounded" data-folder-id="${escapeHtml(folder.id)}" title="Add subfolder"><span class="material-icons-outlined text-[14px]">create_new_folder</span></button>
            <button class="folder-rename p-0.5 text-slate-400 hover:text-primary rounded" data-folder-id="${escapeHtml(folder.id)}" title="Rename"><span class="material-icons-outlined text-[14px]">edit</span></button>
            <button class="folder-delete p-0.5 text-slate-400 hover:text-red-500 rounded" data-folder-id="${escapeHtml(folder.id)}" title="Delete"><span class="material-icons-outlined text-[14px]">delete_outline</span></button>
          </div>
        </div>
        ${isExpanded ? renderLevel(folder.id, level + 1) : ''}
      `;
    }).join('');
  }

  return renderLevel(parentId, depth);
}

function renderFolderSelectOptions(
  folders: Folder[],
  currentFolderId: string | null,
  depth: number,
): string {
  const childrenMap = buildFolderChildren(folders);

  function renderLevel(parentKey: string | null, level: number): string {
    const children = childrenMap.get(parentKey) ?? [];
    return children.map((folder) => {
      const prefix = '\u00A0\u00A0'.repeat(level);
      const selected = folder.id === currentFolderId ? 'selected' : '';
      return `<option value="${escapeHtml(folder.id)}" ${selected}>${prefix}${escapeHtml(folder.name)}</option>`
        + renderLevel(folder.id, level + 1);
    }).join('');
  }

  return renderLevel(null, depth);
}

function formatDashboardTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

async function resolveDashboardAccount(): Promise<DashboardAccountState> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      avatarUrl: null,
      displayName: 'User',
      initials: 'U',
      email: '',
      fullName: '',
      planLabel: '—',
      planDetail: '—',
    };
  }

  const metadata = isRecord(user.user_metadata) ? user.user_metadata : null;
  const metadataName = getRecordString(metadata, 'full_name');
  const metadataAvatar = getRecordString(metadata, 'avatar_url') ?? getRecordString(metadata, 'picture');

  const [profile, limits, subscription] = await Promise.all([
    getOnboardingProfile(user.id).catch(() => null),
    getSubscriptionLimits().catch(() => null),
    getSubscription().catch(() => null),
  ]);

  const displayName = profile?.full_name || metadataName || user.email || 'User';
  const plan = describeAccountPlan(limits, subscription);
  return {
    avatarUrl: metadataAvatar,
    displayName,
    initials: computeInitials(displayName),
    email: user.email ?? '',
    fullName: profile?.full_name ?? metadataName ?? '',
    planLabel: plan.label,
    planDetail: plan.detail,
  };
}

async function hydrateDashboardAccount(container: HTMLElement): Promise<void> {
  try {
    const account = await resolveDashboardAccount();
    applyDashboardAccount(container, account);
    fillAccountForm(container, account);
  } catch (err) {
    console.error('Failed to hydrate dashboard account:', err);
  }
}

function applyDashboardAccount(container: HTMLElement, account: DashboardAccountState): void {
  const avatarRoot = container.querySelector<HTMLElement>('#dashboard-user-avatar');
  const accountName = container.querySelector<HTMLElement>('#dashboard-account-name');
  const accountEmail = container.querySelector<HTMLElement>('#dashboard-account-email');
  const trigger = container.querySelector<HTMLElement>('#dashboard-account-trigger');

  if (accountName) {
    accountName.textContent = account.displayName;
  }

  if (accountEmail) {
    accountEmail.textContent = account.email || 'No email';
  }

  if (trigger) {
    trigger.setAttribute('title', account.displayName);
  }

  if (!avatarRoot) return;
  avatarRoot.setAttribute('title', account.displayName);
  avatarRoot.setAttribute('aria-label', account.displayName);

  if (account.avatarUrl) {
    const image = document.createElement('img');
    image.src = account.avatarUrl;
    image.alt = `${account.displayName} avatar`;
    image.className = 'h-full w-full object-cover';
    avatarRoot.replaceChildren(image);
    return;
  }

  const initials = document.createElement('span');
  initials.className = 'text-primary text-xs font-bold';
  initials.textContent = account.initials;
  avatarRoot.replaceChildren(initials);
}

function wireDashboardAccountInteractions(container: HTMLElement): void {
  const accountRoot = container.querySelector<HTMLElement>('#dashboard-account-root');
  const accountTrigger = container.querySelector<HTMLButtonElement>('#dashboard-account-trigger');
  const accountMenu = container.querySelector<HTMLElement>('#dashboard-account-menu');
  const accountSettingsButton = container.querySelector<HTMLButtonElement>('#btn-account-settings');
  const signOutButton = container.querySelector<HTMLButtonElement>('#btn-sign-out');

  const accountModal = container.querySelector<HTMLElement>('#account-settings-modal');
  const accountCloseButton = container.querySelector<HTMLButtonElement>('#account-modal-close');
  const accountCancelButton = container.querySelector<HTMLButtonElement>('#account-cancel-button');
  const accountForm = container.querySelector<HTMLFormElement>('#account-settings-form');
  const accountSaveButton = container.querySelector<HTMLButtonElement>('#account-save-button');
  const updatePasswordButton = container.querySelector<HTMLButtonElement>('#account-update-password');
  const sendResetButton = container.querySelector<HTMLButtonElement>('#account-send-reset-email');
  const deleteAccountButton = container.querySelector<HTMLButtonElement>('#account-delete-button');
  const deletePasswordInput = container.querySelector<HTMLInputElement>('#account-delete-password');

  if (
    !accountRoot ||
    !accountTrigger ||
    !accountMenu ||
    !accountSettingsButton ||
    !signOutButton ||
    !accountModal ||
    !accountCloseButton ||
    !accountCancelButton ||
    !accountForm ||
    !accountSaveButton ||
    !updatePasswordButton ||
    !sendResetButton ||
    !deleteAccountButton ||
    !deletePasswordInput
  ) {
    return;
  }

  let menuOpen = false;
  const setMenuOpen = (open: boolean): void => {
    menuOpen = open;
    accountMenu.classList.toggle('hidden', !open);
    accountTrigger.setAttribute('aria-expanded', String(open));
  };

  const openAccountModal = (): void => {
    setAccountMessage(container, null);
    accountModal.classList.remove('hidden');
    accountModal.classList.add('flex');
  };

  const closeAccountModal = (): void => {
    accountModal.classList.add('hidden');
    accountModal.classList.remove('flex');
  };

  accountTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setMenuOpen(!menuOpen);
  });

  accountRoot.addEventListener('click', event => event.stopPropagation());
  container.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (!accountRoot.contains(target)) {
      setMenuOpen(false);
    }
  });

  accountSettingsButton.addEventListener('click', () => {
    setMenuOpen(false);
    openAccountModal();
  });

  const billingButton = container.querySelector<HTMLButtonElement>('#btn-billing');
  billingButton?.addEventListener('click', () => {
    setMenuOpen(false);
    router.navigate('/billing');
  });

  signOutButton.addEventListener('click', () => {
    setMenuOpen(false);
    void (async () => {
      try {
        await signOut();
        router.navigate('/auth/sign-in');
      } catch (err) {
        console.error('Sign-out failed:', err);
        await customAlert('Sign-out failed. Please try again.');
      }
    })();
  });

  accountCloseButton.addEventListener('click', closeAccountModal);
  accountCancelButton.addEventListener('click', closeAccountModal);
  accountModal.addEventListener('click', (event) => {
    if (event.target === accountModal) {
      closeAccountModal();
    }
  });

  accountForm.addEventListener('submit', event => {
    event.preventDefault();
    void (async () => {
      accountSaveButton.disabled = true;
      setAccountMessage(container, null);

      try {
        const payload = readAccountProfileInput(container);
        await updateCurrentUserProfile(payload);
        const refreshed = await resolveDashboardAccount();
        applyDashboardAccount(container, refreshed);
        fillAccountForm(container, refreshed);
        setAccountMessage(container, {
          kind: 'success',
          text: 'Account details updated.',
        });
      } catch (err) {
        console.error('Account update failed:', err);
        setAccountMessage(container, {
          kind: 'error',
          text: err instanceof Error ? err.message : 'Failed to update account details.',
        });
      } finally {
        accountSaveButton.disabled = false;
      }
    })();
  });

  updatePasswordButton.addEventListener('click', () => {
    void (async () => {
      const newPasswordInput = container.querySelector<HTMLInputElement>('#account-new-password');
      const confirmPasswordInput = container.querySelector<HTMLInputElement>('#account-confirm-password');
      if (!newPasswordInput || !confirmPasswordInput) return;

      const password = newPasswordInput.value.trim();
      const confirmation = confirmPasswordInput.value.trim();

      if (!password || !confirmation) {
        setAccountMessage(container, {
          kind: 'error',
          text: 'Enter and confirm your new password.',
        });
        return;
      }

      if (password !== confirmation) {
        setAccountMessage(container, {
          kind: 'error',
          text: 'Password confirmation does not match.',
        });
        return;
      }

      updatePasswordButton.disabled = true;
      setAccountMessage(container, null);

      try {
        await updateCurrentUserPassword(password);
        newPasswordInput.value = '';
        confirmPasswordInput.value = '';
        setAccountMessage(container, {
          kind: 'success',
          text: 'Password updated.',
        });
      } catch (err) {
        console.error('Password update failed:', err);
        setAccountMessage(container, {
          kind: 'error',
          text: err instanceof Error ? err.message : 'Password update failed.',
        });
      } finally {
        updatePasswordButton.disabled = false;
      }
    })();
  });

  sendResetButton.addEventListener('click', () => {
    void (async () => {
      const email = getFieldValue(container, '#account-email');
      if (!email) {
        setAccountMessage(container, {
          kind: 'error',
          text: 'Unable to find account email for password reset.',
        });
        return;
      }

      sendResetButton.disabled = true;
      setAccountMessage(container, null);
      try {
        await sendPasswordResetEmail(email);
        setAccountMessage(container, {
          kind: 'success',
          text: `Password reset email sent to ${email}.`,
        });
      } catch (err) {
        console.error('Password reset email failed:', err);
        setAccountMessage(container, {
          kind: 'error',
          text: err instanceof Error ? err.message : 'Failed to send password reset email.',
        });
      } finally {
        sendResetButton.disabled = false;
      }
    })();
  });

  deleteAccountButton.addEventListener('click', () => {
    void (async () => {
      const currentPassword = deletePasswordInput.value.trim();
      if (!currentPassword) {
        setAccountMessage(container, {
          kind: 'error',
          text: 'Enter your current password to confirm account deletion.',
        });
        return;
      }

      if (!(await customConfirm('Delete your account and all projects permanently? This cannot be undone.'))) {
        return;
      }

      deleteAccountButton.disabled = true;
      setAccountMessage(container, null);
      try {
        const email = getFieldValue(container, '#account-email');
        await confirmCurrentPassword(email, currentPassword);
        await deleteCurrentUserAccount();
        router.navigate('/auth/sign-in');
      } catch (err) {
        console.error('Account deletion failed:', err);
        setAccountMessage(container, {
          kind: 'error',
          text: err instanceof Error ? err.message : 'Failed to delete account.',
        });
      } finally {
        deleteAccountButton.disabled = false;
      }
    })();
  });
}

function fillAccountForm(container: HTMLElement, account: DashboardAccountState): void {
  setFormValue(container, '#account-email', account.email);
  setFormValue(container, '#account-full-name', account.fullName || account.displayName);
  setFormValue(container, '#account-plan-label', account.planLabel);
  setFormValue(container, '#account-plan-detail', account.planDetail);
  setFormValue(container, '#account-delete-password', '');
}

function readAccountProfileInput(container: HTMLElement): AccountProfileInput {
  const fullName = getFieldValue(container, '#account-full-name');
  if (!fullName) {
    throw new Error('Full name is required.');
  }

  return {
    fullName,
  };
}

function getFieldValue(container: HTMLElement, selector: string): string {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  return field?.value.trim() ?? '';
}

function setFormValue(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  if (!field) return;
  field.value = value;
}

function setAccountMessage(container: HTMLElement, message: { kind: MessageKind; text: string } | null): void {
  const panel = container.querySelector<HTMLElement>('#account-message');
  if (!panel) return;

  if (!message) {
    panel.className = 'hidden mb-4 rounded-lg border px-3 py-2 text-xs';
    panel.textContent = '';
    return;
  }

  panel.className = message.kind === 'success'
    ? 'mb-4 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100 px-3 py-2 text-xs'
    : 'mb-4 rounded-lg border border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100 px-3 py-2 text-xs';
  panel.textContent = message.text;
}

function renderSelectOptions(options: readonly string[]): string {
  return options.map(option => `< option value = "${option}" > ${option} </option>`).join('');
}

function describeAccountPlan(
  limits: SubscriptionLimits | null,
  subscription: Awaited<ReturnType<typeof getSubscription>> | null,
): { label: string; detail: string } {
  if (limits?.hasFullAccess) {
    const detail = subscription
      ? `${subscription.tier} · status: ${subscription.status}`
      : 'beta/admin full access';
    return { label: 'Full access', detail };
  }

  if (!subscription) {
    return { label: 'Free', detail: 'No active subscription' };
  }

  const end = subscription.currentPeriodEnd ? `ends: ${formatDashboardTimestamp(subscription.currentPeriodEnd)}` : null;
  const cancel = subscription.cancelAtPeriodEnd ? 'canceling' : null;
  const detail = [`${subscription.tier}`, `status: ${subscription.status}`, end, cancel].filter(Boolean).join(' · ');
  return { label: 'Pro', detail };
}

function computeInitials(displayName: string): string {
  const tokens = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length >= 2) {
    return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
  }

  if (tokens.length === 1 && tokens[0].includes('@')) {
    const localPart = tokens[0].split('@')[0];
    const chars = localPart.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2);
    return (chars || 'U').toUpperCase();
  }

  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }

  return 'U';
}

function getRecordString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
