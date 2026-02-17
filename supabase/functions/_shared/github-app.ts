import { SignJWT, importPKCS8 } from 'npm:jose@5.9.6';

export interface GitHubPromptTarget {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}

export interface GitHubPromptFile {
  sha: string;
  path: string;
  content: string;
}

export interface GitHubPromptWriteResult {
  commitSha: string;
  commitUrl: string;
}

interface GitHubInstallationResponse {
  account?: {
    login?: string;
    type?: string;
  };
}

interface GitHubContentsResponse {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
  path?: string;
}

interface GitHubWriteResponse {
  commit?: {
    sha?: string;
    html_url?: string;
  };
}

interface GitHubErrorPayload {
  message?: string;
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getGitHubAppSlug(): string {
  return env('GITHUB_APP_SLUG');
}

export function getAllowedAppOrigin(): string {
  return env('APP_PUBLIC_URL').replace(/\/+$/, '');
}

export function normalizePromptTarget(input: Partial<GitHubPromptTarget>): GitHubPromptTarget {
  const owner = normalizeSimpleSlug(input.owner, 'Repository owner');
  const repo = normalizeSimpleSlug(input.repo, 'Repository name');
  const branch = normalizeBranchName(input.branch);
  const filePath = normalizeFilePath(input.filePath);

  return { owner, repo, branch, filePath };
}

export async function fetchInstallationMetadata(
  installationId: number,
): Promise<{ accountLogin: string; accountType: string }> {
  const jwt = await createGitHubAppJwt();
  const result = await githubRequest<GitHubInstallationResponse>(
    `/app/installations/${installationId}`,
    jwt,
    'Bearer',
  );

  return {
    accountLogin: result.account?.login ?? '',
    accountType: result.account?.type ?? '',
  };
}

export async function createInstallationAccessToken(installationId: number): Promise<string> {
  const jwt = await createGitHubAppJwt();
  const tokenResponse = await githubRequest<{ token?: string }>(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    'Bearer',
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );

  const token = tokenResponse.token?.trim();
  if (!token) {
    throw new Error('GitHub installation access token was not returned.');
  }
  return token;
}

export async function pullPromptFile(
  installationToken: string,
  target: GitHubPromptTarget,
): Promise<GitHubPromptFile> {
  const encodedPath = encodePath(target.filePath);
  const response = await githubRequest<GitHubContentsResponse>(
    `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(target.branch)}`,
    installationToken,
    'token',
  );

  if (response.type !== 'file' || response.encoding?.toLowerCase() !== 'base64' || !response.sha || !response.path) {
    throw new Error('GitHub file response is invalid.');
  }

  return {
    sha: response.sha,
    path: response.path,
    content: decodeUtf8Base64(response.content ?? ''),
  };
}

export async function pushPromptFile(
  installationToken: string,
  target: GitHubPromptTarget,
  promptContent: string,
  commitMessage: string,
): Promise<GitHubPromptWriteResult> {
  const message = commitMessage.trim();
  if (!message) {
    throw new Error('Commit message is required.');
  }

  const existingSha = await readPromptFileShaOptional(installationToken, target);
  const encodedPath = encodePath(target.filePath);
  const response = await githubRequest<GitHubWriteResponse>(
    `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${encodedPath}`,
    installationToken,
    'token',
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: encodeUtf8Base64(promptContent),
        branch: target.branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    },
  );

  const commitSha = response.commit?.sha;
  const commitUrl = response.commit?.html_url;
  if (!commitSha || !commitUrl) {
    throw new Error('GitHub commit response is invalid.');
  }

  return { commitSha, commitUrl };
}

async function readPromptFileShaOptional(token: string, target: GitHubPromptTarget): Promise<string | null> {
  try {
    const file = await pullPromptFile(token, target);
    return file.sha;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('404')) {
      return null;
    }
    throw err;
  }
}

async function createGitHubAppJwt(): Promise<string> {
  const privateKeyPem = normalizePrivateKey(env('GITHUB_APP_PRIVATE_KEY'));
  const appId = env('GITHUB_APP_ID');
  const key = await importPKCS8(privateKeyPem, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(appId)
    .sign(key);
}

async function githubRequest<T>(
  path: string,
  token: string,
  authorizationScheme: 'Bearer' | 'token',
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `${authorizationScheme} ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json() as GitHubErrorPayload;
      if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
        message = `${response.status} ${payload.message}`;
      }
    } catch {
      // Keep fallback message.
    }
    throw new Error(`GitHub API request failed: ${message}`);
  }

  return await response.json() as T;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n').trim();
}

function normalizeSimpleSlug(value: string | undefined, fieldName: string): string {
  const normalized = (value ?? '').trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`${fieldName} cannot contain slashes.`);
  }
  return normalized;
}

function normalizeBranchName(value: string | undefined): string {
  const branch = (value ?? '').trim();
  if (!branch) {
    throw new Error('Branch is required.');
  }
  if (branch.includes('..') || /\s/.test(branch)) {
    throw new Error('Branch contains invalid characters.');
  }
  return branch;
}

function normalizeFilePath(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) {
    throw new Error('Prompt file path is required.');
  }

  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  if (!normalized || normalized.endsWith('/')) {
    throw new Error('Prompt file path must point to a file.');
  }
  if (normalized.includes('..')) {
    throw new Error('Prompt file path cannot contain "..".');
  }
  return normalized;
}

function encodePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function decodeUtf8Base64(value: string): string {
  const compact = value.replace(/\s+/g, '');
  const binary = atob(compact);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
