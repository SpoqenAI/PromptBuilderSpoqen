import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { mcpRelayPlugin } from './vite.plugin.mcp-relay';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['NEXT_PUBLIC_', 'VITE_']);
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');

  return {
    plugins: [
      tailwindcss(),
      mcpRelayPlugin(),
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
      }),
    ],
    root: '.',
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    base: '/builder/',
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    server: {
      proxy: supabaseUrl
        ? {
            '/builder/api/supabase-functions': {
              target: supabaseUrl,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/builder\/api\/supabase-functions/, '/functions/v1'),
              secure: true,
            },
          }
        : undefined,
    },
  };
});
