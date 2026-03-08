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

`APP_PUBLIC_URL` must match the **exact** URL you use in the browser (including port), or CORS will block Edge Function calls (e.g. create-checkout-session). Examples:

- `http://localhost:5173` if your app runs on port 5173
- `http://localhost:5174` if your app runs on port 5174 (or any other port)
- `http://127.0.0.1:5173` if you use 127.0.0.1 instead of localhost
- `https://yourapp.com` in production

## 3. Deploy Functions (Safe Default)

Use the repo deploy script below instead of raw `supabase functions deploy`.
This enforces `--no-verify-jwt` for handler-auth functions (`requireUser(...)`) and for public callback routes that must be reachable without gateway JWT verification.

```bash
powershell.exe -ExecutionPolicy Bypass -File .\supabase\functions\deploy-all-functions.ps1
```

To include authenticated smoke checks (requires `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD` or `-AccessToken` path):

```bash
powershell.exe -ExecutionPolicy Bypass -File .\supabase\functions\deploy-all-functions.ps1 -RequireAuthSmoke
```

If you need manual per-function deploy commands:

```bash
supabase functions deploy github-connect-url --no-verify-jwt
supabase functions deploy github-app-callback --no-verify-jwt
supabase functions deploy github-prompt-sync --no-verify-jwt
supabase functions deploy flow-to-prompt --no-verify-jwt
supabase functions deploy prompt-repair-run --no-verify-jwt
supabase functions deploy apply-prompt-repair --no-verify-jwt
# IMPORTANT: use the script below for transcript-flow-map (delete + redeploy + smoke test).
powershell.exe -ExecutionPolicy Bypass -File .\supabase\functions\deploy-transcript-flow-map.ps1
```

## 3b. Transcript Flow AI Mapping

The transcript-to-flow feature uses `transcript-flow-map`.

Set function secrets:

```bash
supabase secrets set OPENAI_API_KEY=<your-openai-api-key>
supabase secrets set OPENAI_TRANSCRIPT_MODEL=gpt-5-nano
supabase secrets set OPENAI_TRANSCRIPT_TEMPERATURE=default
supabase secrets set GROQ_API_KEY=<your-groq-api-key>
supabase secrets set GROQ_MODEL=llama-3.3-70b-versatile
```

The function uses Groq first when `GROQ_API_KEY` is configured, then OpenAI when `OPENAI_API_KEY` is configured, then deterministic mapping.

`transcript-flow-map` and other handler-auth functions are deployed with `--no-verify-jwt` because they perform explicit token verification in-function using `requireUser(...)`. This avoids gateway-side JWT rejection while preserving authenticated access control.

`OPENAI_TRANSCRIPT_TEMPERATURE` is optional. Set it to `default` (or leave unset) to omit `temperature` from the request. This is recommended for models like `gpt-5-nano` that only support default temperature behavior.

### transcript-flow-map deploy rule (do not skip)

Always deploy `transcript-flow-map` with:

- `pwsh ./supabase/functions/deploy-transcript-flow-map.ps1`

What this script does:

1. Deletes `transcript-flow-map` (forces config refresh)
2. Deploys with `--no-verify-jwt`
3. Runs a smoke test to confirm gateway JWT verification is not intercepting requests

### Smoke test all edge functions

After deploy, run:

- `pwsh ./supabase/functions/test-edge-functions.ps1`

This performs unauthenticated reachability checks against every deployed function (including CORS OPTIONS), which is useful when JWT gateway behavior is unstable.

For authenticated checks (recommended once you have a stable test user), provide either:

- `-AccessToken <jwt>`
- or environment vars `SUPABASE_TEST_EMAIL` and `SUPABASE_TEST_PASSWORD` (script will mint a token via `/auth/v1/token`), then run:
  - `pwsh ./supabase/functions/test-edge-functions.ps1 -RequireAuth`

## 3c. Stripe Subscription Billing

The app supports Individual and Enterprise subscription tiers via Stripe.

### Set Stripe function secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=<your-stripe-secret-key>
supabase secrets set STRIPE_WEBHOOK_SECRET=<your-stripe-webhook-signing-secret>
supabase secrets set STRIPE_INDIVIDUAL_PRICE_ID=<price_xxx>
supabase secrets set STRIPE_ENTERPRISE_PRICE_ID=<price_yyy>
```

- `STRIPE_SECRET_KEY`: Stripe API secret key (starts with `sk_test_` or `sk_live_`).
- `STRIPE_WEBHOOK_SECRET`: Signing secret from the Stripe webhook endpoint settings (starts with `whsec_`).
- `STRIPE_INDIVIDUAL_PRICE_ID` / `STRIPE_ENTERPRISE_PRICE_ID`: Recurring price IDs from Stripe Dashboard (Products).

### Stripe Products Setup

1. In the [Stripe Dashboard](https://dashboard.stripe.com/products), create two Products:
   - **Spoqen Individual** — with a recurring Price (monthly or yearly).
   - **Spoqen Enterprise** — with a recurring Price (monthly or yearly).
2. Copy each Price ID and set as Supabase secrets above.

### Stripe Webhook Endpoint

1. In Stripe Dashboard → Developers → Webhooks, add an endpoint:
   - URL: `https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
2. Copy the Signing Secret and set as `STRIPE_WEBHOOK_SECRET`.

### Deploy Stripe Functions

```bash
supabase functions deploy create-checkout-session --no-verify-jwt
supabase functions deploy create-portal-session --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
```

`create-checkout-session` and `create-portal-session` perform explicit JWT verification via `requireUser()`. `stripe-webhook` verifies the Stripe signature instead of JWT.

### Database Migration

Run the migration to create `stripe_customers` and `subscriptions` tables:

- `supabase/migrations/20260224120000_add_stripe_subscriptions.sql`

### CORS and APP_PUBLIC_URL (required for billing)

If you see "CORS request did not succeed" or "Access-Control-Allow-Origin does not match" when clicking **Get Started** on the billing page, the Edge Function is returning an origin that doesn't match your browser. Set one of:

```bash
# Option 1: full URL (use the exact URL and port from your address bar)
supabase secrets set APP_PUBLIC_URL=http://localhost:5174

# Option 2: port only (function will use http://localhost:5174)
supabase secrets set LOCALHOST_PORT=5174
```

Then **redeploy** the billing Edge Functions so they use the new CORS logic:

```bash
supabase functions deploy create-checkout-session --no-verify-jwt
supabase functions deploy create-portal-session
```

### Frontend

The billing page is available at `#/billing`. Users can also access it from the account dropdown menu on the dashboard.

## 4. Apply Database Migration

Run migrations so these tables exist:

- `public.github_app_oauth_states`
- `public.github_installations`
- `public.optimization_run_patches`
- `public.prompt_node_sync_meta`

The migration files are:

- `supabase/migrations/20260217103000_add_github_app_integrations.sql`
- `supabase/migrations/20260224120000_add_stripe_subscriptions.sql`
- `supabase/migrations/20260228103000_add_prompt_repair_tables.sql`
