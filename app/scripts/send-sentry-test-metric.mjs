/**
 * Sends a test metric to Sentry. Run from app dir: node scripts/send-sentry-test-metric.mjs
 * Loads VITE_SENTRY_DSN from .env.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as Sentry from '@sentry/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = join(__dirname, '..');
// Prefer .env in cwd (when run via "npm run test:sentry-metric" from app dir), then app dir
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

Sentry.metrics.count('app.initialized', 1, {
  attributes: { source: 'sentry_test_metric' },
});

await Sentry.flush();
console.log('Test metric sent. Check Sentry → Explore → Metrics for "app.initialized".');
process.exit(0);
