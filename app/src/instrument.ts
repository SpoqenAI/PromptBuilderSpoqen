/**
 * Sentry must initialize before any other application code.
 * This file is imported first in main.ts.
 */
import * as Sentry from '@sentry/browser';

const dsn = import.meta.env.VITE_SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,

  sendDefaultPii: true,

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.2,
  tracePropagationTargets: ['localhost', /^https:\/\/.*\.supabase\.co/],

  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

// Send a test metric on load so you can verify metrics in Sentry (Explore > Metrics).
if (dsn) {
  Sentry.metrics.count('app.initialized', 1, {
    attributes: { source: 'sentry_test_metric' },
  });
}
