# GitHub App Integration Setup

This project uses a production-style GitHub App flow:

- Browser redirect for `Connect GitHub`
- Server-side token minting in Edge Functions
- No personal access token entry in the frontend
- Prompt sync scoped to one configured prompt file path

## 1. Create/Configure GitHub App

In GitHub Developer Settings:

1. Create a GitHub App.
2. Grant repository permissions:
   - `Contents: Read and write`
3. Install the app on the repos/orgs you want.
4. Set the app **Setup URL** to:
   - `https://<your-project-ref>.supabase.co/functions/v1/github-app-callback`
5. Save:
   - App slug
   - App ID
   - Private key PEM

## 2. Set Supabase Function Secrets

```bash
supabase secrets set GITHUB_APP_SLUG=<github-app-slug>
supabase secrets set GITHUB_APP_ID=<github-app-id>
supabase secrets set GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
supabase secrets set APP_PUBLIC_URL=<your-frontend-origin>
```

`APP_PUBLIC_URL` should match your app origin exactly (for redirect safety), for example:

- `http://localhost:5173` in local dev
- `https://yourapp.com` in production

## 3. Deploy Functions

```bash
supabase functions deploy github-connect-url
supabase functions deploy github-app-callback
supabase functions deploy github-prompt-sync
```

## 4. Apply Database Migration

Run migrations so these tables exist:

- `public.github_app_oauth_states`
- `public.github_installations`

The migration file is:

- `supabase/migrations/20260217103000_add_github_app_integrations.sql`

