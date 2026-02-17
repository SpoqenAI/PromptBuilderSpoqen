import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  createInstallationAccessToken,
  normalizePromptTarget,
  pullPromptFile,
  pushPromptFile,
  type GitHubPromptTarget,
} from '../_shared/github-app.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';

type GitHubSyncAction = 'status' | 'disconnect' | 'pull' | 'push';

interface SyncRequestBody {
  action?: GitHubSyncAction;
  target?: Partial<GitHubPromptTarget>;
  promptContent?: string;
  commitMessage?: string;
}

interface InstallationRow {
  installation_id: number;
  account_login: string;
  account_type: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  try {
    const body = await parseJson<SyncRequestBody>(req);
    const action = body.action;
    if (!action) {
      return jsonResponse(400, { error: 'Missing action.' });
    }

    const adminClient = createAdminClient();
    const user = await requireUser(req, adminClient);
    const installation = await getInstallation(adminClient, user.id);

    if (action === 'status') {
      return jsonResponse(200, {
        connected: Boolean(installation),
        accountLogin: installation?.account_login ?? '',
        accountType: installation?.account_type ?? '',
      });
    }

    if (action === 'disconnect') {
      if (installation) {
        const deleteRes = await adminClient
          .from('github_installations')
          .delete()
          .eq('user_id', user.id);
        if (deleteRes.error) {
          throw new Error(`Failed to disconnect GitHub: ${deleteRes.error.message}`);
        }
      }

      return jsonResponse(200, {
        connected: false,
      });
    }

    if (!installation) {
      return jsonResponse(400, { error: 'GitHub is not connected for this account.' });
    }

    const target = normalizePromptTarget(body.target ?? {});
    const installationToken = await createInstallationAccessToken(installation.installation_id);

    if (action === 'pull') {
      const file = await pullPromptFile(installationToken, target);
      return jsonResponse(200, {
        content: file.content,
        path: file.path,
        sha: file.sha,
      });
    }

    if (action === 'push') {
      const promptContent = typeof body.promptContent === 'string' ? body.promptContent : '';
      const commitMessage = typeof body.commitMessage === 'string' ? body.commitMessage : '';

      if (!commitMessage.trim()) {
        return jsonResponse(400, { error: 'Commit message is required.' });
      }

      const result = await pushPromptFile(installationToken, target, promptContent, commitMessage);
      return jsonResponse(200, {
        commitSha: result.commitSha,
        commitUrl: result.commitUrl,
      });
    }

    return jsonResponse(400, { error: 'Unsupported action.' });
  } catch (err) {
    return jsonResponse(400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

async function parseJson<T>(req: Request): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    return {} as T;
  }
}

async function getInstallation(adminClient: ReturnType<typeof createAdminClient>, userId: string): Promise<InstallationRow | null> {
  const rowRes = await adminClient
    .from('github_installations')
    .select('installation_id,account_login,account_type')
    .eq('user_id', userId)
    .maybeSingle();

  if (rowRes.error) {
    throw new Error(`Failed to load GitHub installation: ${rowRes.error.message}`);
  }

  if (!rowRes.data) return null;
  const row = rowRes.data as Partial<InstallationRow>;
  if (
    typeof row.installation_id !== 'number' ||
    typeof row.account_login !== 'string' ||
    typeof row.account_type !== 'string'
  ) {
    throw new Error('Invalid GitHub installation row.');
  }
  return row as InstallationRow;
}
