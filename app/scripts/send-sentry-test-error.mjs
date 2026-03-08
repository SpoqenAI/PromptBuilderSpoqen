/**
 * Sends an intentional test error to Sentry to verify error monitoring.
 * Run from app dir: node scripts/send-sentry-test-error.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as Sentry from '@sentry/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = join(__dirname, '..');
const envPath = existsSync(join(process.cwd(), '.env'))
  ? join(process.cwd(), '.env')
  : join(appDir, '.env');

if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.replace(/\r$/, '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      process.env[key] = val;
    }
  }
}

const dsn = process.env.VITE_SENTRY_DSN;
if (!dsn) {
  console.error('VITE_SENTRY_DSN not set. Set it in app/.env or pass VITE_SENTRY_DSN in the environment.');
  process.exit(1);
}

Sentry.init({
  dsn,
  environment: process.env.NODE_ENV || 'development',
});

const testError = new Error('[Sentry test] Intentional error to verify error monitoring');
testError.name = 'SentryTestError';
Sentry.captureException(testError);

await Sentry.flush();
console.log('Test error sent to Sentry. Check Sentry → Issues for "SentryTestError" / "[Sentry test] Intentional error...".');
process.exit(0);
