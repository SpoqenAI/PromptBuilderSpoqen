/**
 * Dashboard View — Project card grid (matches page1.html mockup)
 */
import { store, type TranscriptFlowDraft } from '../store';
import { router } from '../router';
import {
  deleteCurrentUserAccount,
  getCurrentUser,
  getOnboardingProfile,
  sendPasswordResetEmail,
  signOut,
  updateCurrentUserPassword,
  updateCurrentUserProfile,
  type AccountProfileInput,
} from '../auth';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import { clearProjectEscapeToCanvas } from './project-nav';
import { customAlert, customConfirm } from '../dialogs';
import { preserveScrollDuringRender } from '../view-state';

type DashboardLayout = 'grid' | 'list';
const DASHBOARD_LAYOUT_KEY = 'promptblueprint_dashboard_layout';

const ROLE_OPTIONS = ['Founder', 'Product Manager', 'Engineer', 'Designer', 'Marketer', 'Operations', 'Other'] as const;
const HEARD_ABOUT_OPTIONS = [
  'Search engine',
  'Social media',
  'Friend or colleague',
  'Community',
  'Newsletter',
  'Event',
  'Other',
] as const;
const TEAM_SIZE_OPTIONS = ['Solo', '2-5', '6-20', '21-100', '101+'] as const;

interface DashboardAccountState {
  avatarUrl: string | null;
  displayName: string;
  initials: string;
  email: string;
  fullName: string;
  role: string;
  heardAbout: string;
  primaryGoal: string;
  primaryUseCase: string;
  teamSize: string;
}

type MessageKind = 'success' | 'error';

export function renderDashboard(container: HTMLElement): void {
  preserveScrollDuringRender(container, () => {
    clearProjectEscapeToCanvas(container);
    const promptProjects = store.getPromptFlowProjects();
    const transcriptFlows = store.getTranscriptFlowDrafts();

    container.innerHTML = `
      <!-- Top Navigation Bar -->
      <nav class="sticky top-0 z-50 bg-white/80 dark:bg-background-dark/80 backdrop-blur-md border-b border-card-border dark:border-primary/20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="min-h-16 py-3 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <img src="/Spoqen(2).svg" alt="Spoqen" class="h-8 w-auto" />
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

    <main data-scroll-preserve="dashboard-main" class="flex-1 min-h-0 overflow-y-auto custom-scrollbar max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
      <!-- Action Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-white leading-tight">Project Dashboard</h1>
          <p class="text-neutral-gray dark:text-neutral-gray/80 text-sm mt-1">Manage and orchestrate your node-based AI workflows.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 sm:justify-end">
          <div class="flex bg-white dark:bg-slate-800 border border-card-border dark:border-primary/20 rounded-lg p-1">
            <button id="btn-grid-view" type="button" aria-label="Grid view" aria-pressed="true" class="p-1.5 rounded-md transition-colors bg-primary/10 text-primary">
              <span class="material-icons-outlined text-sm">grid_view</span>
            </button>
            <button id="btn-list-view" type="button" aria-label="List view" aria-pressed="false" class="p-1.5 rounded-md transition-colors text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700">
              <span class="material-icons-outlined text-sm">view_list</span>
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
          ${promptProjects.map((project) => renderPromptFlowCard(project)).join('')}

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
            <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Stored transcript mappings that can be opened or converted into editable canvas projects.</p>
          </div>
          <span class="text-[11px] text-slate-400">${transcriptFlows.length} transcript sets</span>
        </div>
        <div id="transcript-flow-grid" class="dashboard-project-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          ${transcriptFlows.map((flow) => renderTranscriptFlowCard(flow)).join('')}

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

        <form id="account-settings-form" class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label for="account-email" class="block text-xs font-medium text-slate-500 mb-1">Email</label>
              <input id="account-email" type="email" readonly class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-sm text-slate-600 dark:text-slate-300" />
            </div>
            <div class="sm:col-span-2">
              <label for="account-full-name" class="block text-xs font-medium text-slate-500 mb-1">Full name</label>
              <input id="account-full-name" type="text" required class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label for="account-role" class="block text-xs font-medium text-slate-500 mb-1">Role</label>
              <select id="account-role" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                ${renderSelectOptions(ROLE_OPTIONS)}
              </select>
            </div>
            <div>
              <label for="account-team-size" class="block text-xs font-medium text-slate-500 mb-1">Team size</label>
              <select id="account-team-size" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                ${renderSelectOptions(TEAM_SIZE_OPTIONS)}
              </select>
            </div>
            <div class="sm:col-span-2">
              <label for="account-heard-about" class="block text-xs font-medium text-slate-500 mb-1">How did you hear about Spoqen?</label>
              <select id="account-heard-about" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                ${renderSelectOptions(HEARD_ABOUT_OPTIONS)}
              </select>
            </div>
            <div class="sm:col-span-2">
              <label for="account-goal" class="block text-xs font-medium text-slate-500 mb-1">Primary goal</label>
              <textarea id="account-goal" rows="3" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"></textarea>
            </div>
            <div class="sm:col-span-2">
              <label for="account-use-case" class="block text-xs font-medium text-slate-500 mb-1">Primary use case</label>
              <textarea id="account-use-case" rows="3" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"></textarea>
            </div>
          </div>

          <div class="pt-3 border-t border-card-border dark:border-primary/10">
            <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-100">Password</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Set a new password now or send yourself a reset email.</p>
            <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label for="account-new-password" class="block text-xs font-medium text-slate-500 mb-1">New password</label>
                <input id="account-new-password" type="password" minlength="8" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label for="account-confirm-password" class="block text-xs font-medium text-slate-500 mb-1">Confirm password</label>
                <input id="account-confirm-password" type="password" minlength="8" class="w-full rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
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
              <input id="account-delete-confirm" type="text" placeholder="Type DELETE to confirm" class="w-full sm:w-64 rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-400" />
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
    container.querySelectorAll<HTMLElement>('.prompt-project-card, .transcript-project-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('.delete-project,.create-transcript-project,.open-transcript-project')) return;
        const projectId = card.dataset.projectId;
        if (projectId) router.navigate(`/project/${projectId}`);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.open-transcript-project').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const projectId = button.dataset.projectId;
        if (!projectId) return;
        router.navigate(`/project/${projectId}`);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.create-transcript-project').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const transcriptSetId = button.dataset.transcriptSetId;
        if (!transcriptSetId) return;
        const project = store.createProjectFromTranscriptFlowDraft(transcriptSetId);
        if (!project) {
          await customAlert('This transcript set does not have a generated flow to edit yet.');
          return;
        }
        router.navigate(`/project/${project.id}`);
      });
    });

    container.querySelectorAll<HTMLElement>('.delete-project').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const projectId = button.dataset.id;
        if (projectId && await customConfirm('Delete this project?')) {
          store.deleteProject(projectId);
          renderDashboard(container);
        }
      });
    });

    container.querySelectorAll<HTMLElement>('.delete-transcript-flow').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const transcriptSetId = button.dataset.transcriptSetId;
        if (!transcriptSetId) return;
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

    container.querySelector('#btn-import-prompt')?.addEventListener('click', () => router.navigate('/import'));
    container.querySelector('#btn-import-transcript')?.addEventListener('click', () => router.navigate('/import/transcript'));
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
          const name = (container.querySelector('#modal-name') as HTMLInputElement).value.trim();
          const desc = (container.querySelector('#modal-desc') as HTMLTextAreaElement).value.trim();
          const model = (container.querySelector('#modal-model') as HTMLSelectElement).value;
          const project = modalMode === 'transcript'
            ? await store.createTranscriptFlowProject(name || 'Untitled Transcript Flow', desc, model)
            : store.createProject(name || 'Untitled Blueprint', desc, model);
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

    // Theme toggle
    wireThemeToggle(container);
    wireDashboardAccountInteractions(container);
    void hydrateDashboardAccount(container);
  });
}

function renderPromptFlowCard(project: {
  id: string;
  icon: string;
  name: string;
  description: string;
  model: string;
  lastEdited: string;
}): string {
  return `
    <div class="dashboard-search-card prompt-project-card project-card group bg-white dark:bg-slate-800/50 border border-card-border dark:border-primary/10 rounded-xl transition-all duration-200 cursor-pointer overflow-hidden flex flex-col" data-project-id="${escapeHtml(project.id)}">
      <div class="project-card-hero h-32 bg-slate-50 dark:bg-slate-900/50 relative overflow-hidden flex items-center justify-center border-b border-card-border dark:border-primary/5">
        <div class="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity" style="background-image: radial-gradient(#23956F 1.5px, transparent 1.5px); background-size: 12px 12px;"></div>
        <span class="material-icons-outlined text-slate-300 dark:text-slate-700 text-5xl">${escapeHtml(project.icon)}</span>
      </div>
      <div class="project-card-body p-5 flex-1 flex flex-col">
        <div class="flex justify-between items-start mb-2 gap-2">
          <h3 class="font-semibold text-slate-800 dark:text-slate-100 group-hover:text-primary transition-colors">${escapeHtml(project.name)}</h3>
          <button class="delete-project text-slate-400 hover:text-red-500 dark:hover:text-red-400 shrink-0" data-id="${escapeHtml(project.id)}" title="Delete project">
            <span class="material-icons-outlined text-lg">delete_outline</span>
          </button>
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
        </div>
      </div>
    </div>
  `;
}

function renderTranscriptFlowCard(flow: TranscriptFlowDraft): string {
  const linkedProject = flow.projectId ? store.getProject(flow.projectId) ?? null : null;
  const linkedProjectId = linkedProject?.id ?? null;
  const latestFlow = flow.latestFlow;
  const model = linkedProject?.model || latestFlow?.model || 'unknown';
  const flowTitle = linkedProject?.name || latestFlow?.flowTitle || flow.name.replace(/\s+Transcript Set$/, '') || 'Transcript Flow';
  const flowSummary = linkedProject?.description || latestFlow?.flowSummary || flow.description || 'Stored transcript flow mapping.';
  const nodeCount = linkedProject?.nodes.length ?? latestFlow?.nodeCount ?? 0;
  const connectionCount = linkedProject?.connections.length ?? latestFlow?.connectionCount ?? 0;
  const updatedAt = linkedProject?.lastEdited || latestFlow?.createdAt || flow.updatedAt;

  return `
    <div class="dashboard-search-card ${linkedProjectId ? 'transcript-project-card cursor-pointer' : ''} project-card group bg-white dark:bg-slate-800/50 border border-card-border dark:border-primary/10 rounded-xl transition-all duration-200 overflow-hidden flex flex-col"
      data-project-id="${linkedProjectId ? escapeHtml(linkedProjectId) : ''}">
      <div class="project-card-hero h-32 bg-slate-50 dark:bg-slate-900/50 relative overflow-hidden flex items-center justify-center border-b border-card-border dark:border-primary/5">
        <div class="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity" style="background-image: radial-gradient(#23956F 1.5px, transparent 1.5px); background-size: 12px 12px;"></div>
        <span class="material-icons-outlined text-slate-300 dark:text-slate-700 text-5xl">smart_toy</span>
      </div>
      <div class="project-card-body p-5 flex-1 flex flex-col">
        <div class="flex items-start justify-between gap-2 mb-2">
          <h3 class="font-semibold text-slate-800 dark:text-slate-100 group-hover:text-primary transition-colors">${escapeHtml(flowTitle)}</h3>
          <button class="delete-transcript-flow text-slate-400 hover:text-red-500 dark:hover:text-red-400 shrink-0" data-transcript-set-id="${escapeHtml(flow.transcriptSetId)}" data-project-id="${linkedProjectId ? escapeHtml(linkedProjectId) : ''}" title="Delete transcript flow">
            <span class="material-icons-outlined text-lg">delete_outline</span>
          </button>
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
            ${linkedProjectId
      ? `<button class="open-transcript-project px-2.5 py-1 text-[11px] font-medium border border-primary/30 text-primary hover:bg-primary/5 rounded transition-colors" data-project-id="${escapeHtml(linkedProjectId)}">Open in Canvas</button>`
      : `<button class="create-transcript-project px-2.5 py-1 text-[11px] font-medium bg-primary text-white hover:bg-primary/90 rounded transition-colors" data-transcript-set-id="${escapeHtml(flow.transcriptSetId)}">Create Editable Flow</button>`}
          </div>
        </div>
      </div>
    </div>
  `;
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
      role: '',
      heardAbout: '',
      primaryGoal: '',
      primaryUseCase: '',
      teamSize: '',
    };
  }

  const metadata = isRecord(user.user_metadata) ? user.user_metadata : null;
  const metadataName = getRecordString(metadata, 'full_name');
  const metadataAvatar = getRecordString(metadata, 'avatar_url') ?? getRecordString(metadata, 'picture');

  let profile = null;
  try {
    profile = await getOnboardingProfile(user.id);
  } catch {
    profile = null;
  }

  const displayName = profile?.full_name || metadataName || user.email || 'User';
  return {
    avatarUrl: metadataAvatar,
    displayName,
    initials: computeInitials(displayName),
    email: user.email ?? '',
    fullName: profile?.full_name ?? metadataName ?? '',
    role: profile?.role ?? '',
    heardAbout: profile?.heard_about ?? '',
    primaryGoal: profile?.primary_goal ?? '',
    primaryUseCase: profile?.primary_use_case ?? '',
    teamSize: profile?.team_size ?? '',
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
  const deleteConfirmInput = container.querySelector<HTMLInputElement>('#account-delete-confirm');

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
    !deleteConfirmInput
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
      if (deleteConfirmInput.value.trim().toUpperCase() !== 'DELETE') {
        setAccountMessage(container, {
          kind: 'error',
          text: 'Type DELETE to confirm account deletion.',
        });
        return;
      }

      if (!(await customConfirm('Delete your account and all projects permanently? This cannot be undone.'))) {
        return;
      }

      deleteAccountButton.disabled = true;
      setAccountMessage(container, null);
      try {
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
  setFormValue(container, '#account-role', account.role || ROLE_OPTIONS[0]);
  setFormValue(container, '#account-team-size', account.teamSize || TEAM_SIZE_OPTIONS[0]);
  setFormValue(container, '#account-heard-about', account.heardAbout || HEARD_ABOUT_OPTIONS[0]);
  setFormValue(container, '#account-goal', account.primaryGoal);
  setFormValue(container, '#account-use-case', account.primaryUseCase);
  setFormValue(container, '#account-delete-confirm', '');
}

function readAccountProfileInput(container: HTMLElement): AccountProfileInput {
  const fullName = getFieldValue(container, '#account-full-name');
  if (!fullName) {
    throw new Error('Full name is required.');
  }

  return {
    fullName,
    role: getFieldValue(container, '#account-role'),
    heardAbout: getFieldValue(container, '#account-heard-about'),
    primaryGoal: getFieldValue(container, '#account-goal'),
    primaryUseCase: getFieldValue(container, '#account-use-case'),
    teamSize: getFieldValue(container, '#account-team-size'),
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
  return options.map(option => `<option value="${option}">${option}</option>`).join('');
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
