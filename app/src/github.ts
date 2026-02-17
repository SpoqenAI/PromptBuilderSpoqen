import { supabase } from './supabase';

export interface GitHubPromptSyncConfig {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}

export interface GitHubPromptFile {
  sha: string;
  content: string;
  path: string;
}

export interface GitHubPromptWriteResult {
  commitSha: string;
  commitUrl: string;
}

export interface GitHubConnectionStatus {
  connected: boolean;
  accountLogin: string;
  accountType: string;
}

interface GitHubSyncStatusResponse {
  connected?: boolean;
  accountLogin?: string;
  accountType?: string;
  error?: string;
}

interface GitHubSyncPullResponse {
  content?: string;
  path?: string;
  sha?: string;
  error?: string;
}

interface GitHubSyncPushResponse {
  commitSha?: string;
  commitUrl?: string;
  error?: string;
}

interface GitHubSyncDisconnectResponse {
  connected?: boolean;
  error?: string;
}

interface GitHubConnectUrlResponse {
  url?: string;
  error?: string;
}

const CONFIG_STORAGE_PREFIX = 'promptblueprint_github_prompt_sync_config_';

export function loadGitHubPromptSyncConfig(projectId: string): GitHubPromptSyncConfig | null {
  const raw = localStorage.getItem(configStorageKey(projectId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<GitHubPromptSyncConfig>;
    return normalizeGitHubPromptSyncConfig(parsed);
  } catch {
    return null;
  }
}

export function saveGitHubPromptSyncConfig(projectId: string, config: GitHubPromptSyncConfig): void {
  const normalized = normalizeGitHubPromptSyncConfig(config);
  localStorage.setItem(configStorageKey(projectId), JSON.stringify(normalized));
}

export function clearGitHubPromptSyncConfig(projectId: string): void {
  localStorage.removeItem(configStorageKey(projectId));
}

export function normalizeGitHubPromptSyncConfig(input: Partial<GitHubPromptSyncConfig>): GitHubPromptSyncConfig {
  const owner = normalizeSimpleSlug(input.owner, 'repository owner');
  const repo = normalizeSimpleSlug(input.repo, 'repository name');
  const branch = normalizeBranchName(input.branch);
  const filePath = normalizeFilePath(input.filePath);
  return { owner, repo, branch, filePath };
}

export async function createGitHubConnectUrl(redirectTo: string): Promise<string> {
  const response = await supabase.functions.invoke<GitHubConnectUrlResponse>('github-connect-url', {
    body: { redirectTo },
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  const url = response.data?.url;
  if (!url) {
    throw new Error(response.data?.error ?? 'GitHub connect URL was not returned.');
  }
  return url;
}

export async function getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  const data = await invokeGitHubSync<GitHubSyncStatusResponse>({ action: 'status' });
  return {
    connected: data.connected === true,
    accountLogin: data.accountLogin ?? '',
    accountType: data.accountType ?? '',
  };
}

export async function disconnectGitHubConnection(): Promise<void> {
  await invokeGitHubSync<GitHubSyncDisconnectResponse>({ action: 'disconnect' });
}

export async function readPromptFileFromGitHub(config: GitHubPromptSyncConfig): Promise<GitHubPromptFile> {
  const normalized = normalizeGitHubPromptSyncConfig(config);
  const data = await invokeGitHubSync<GitHubSyncPullResponse>({
    action: 'pull',
    target: normalized,
  });

  if (typeof data.content !== 'string' || typeof data.sha !== 'string' || typeof data.path !== 'string') {
    throw new Error('GitHub pull response is invalid.');
  }

  return {
    content: data.content,
    sha: data.sha,
    path: data.path,
  };
}

export async function upsertPromptFileToGitHub(
  config: GitHubPromptSyncConfig,
  promptContent: string,
  commitMessage: string,
): Promise<GitHubPromptWriteResult> {
  const normalized = normalizeGitHubPromptSyncConfig(config);
  const message = commitMessage.trim();
  if (!message) {
    throw new Error('Commit message is required.');
  }

  const data = await invokeGitHubSync<GitHubSyncPushResponse>({
    action: 'push',
    target: normalized,
    promptContent,
    commitMessage: message,
  });

  if (typeof data.commitSha !== 'string' || typeof data.commitUrl !== 'string') {
    throw new Error('GitHub push response is invalid.');
  }

  return {
    commitSha: data.commitSha,
    commitUrl: data.commitUrl,
  };
}

async function invokeGitHubSync<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await supabase.functions.invoke<T & { error?: string }>('github-prompt-sync', {
    body: payload,
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  const data = response.data;
  if (!data) {
    throw new Error('GitHub sync returned an empty response.');
  }

  if (typeof data === 'object' && data !== null && 'error' in data) {
    const maybeError = (data as { error?: unknown }).error;
    if (typeof maybeError === 'string' && maybeError.trim().length > 0) {
      throw new Error(maybeError);
    }
  }

  return data as T;
}

function configStorageKey(projectId: string): string {
  return `${CONFIG_STORAGE_PREFIX}${projectId}`;
}

function normalizeSimpleSlug(value: string | undefined, field: string): string {
  const normalized = (value ?? '').trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`${field} cannot contain slashes.`);
  }
  return normalized;
}

function normalizeBranchName(value: string | undefined): string {
  const normalized = (value ?? '').trim();
  if (!normalized) {
    throw new Error('Branch is required.');
  }
  if (normalized.includes('..') || /\s/.test(normalized)) {
    throw new Error('Branch contains invalid characters.');
  }
  return normalized;
}

function normalizeFilePath(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    throw new Error('Prompt file path is required.');
  }
  const collapsed = trimmed.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  if (!collapsed || collapsed.endsWith('/')) {
    throw new Error('Prompt file path must target a file.');
  }
  if (collapsed.includes('..')) {
    throw new Error('Prompt file path cannot contain "..".');
  }
  return collapsed;
}
