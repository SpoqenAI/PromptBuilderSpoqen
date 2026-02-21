import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { mcpRelayPlugin } from './vite.plugin.mcp-relay';

export default defineConfig({
  plugins: [tailwindcss(), mcpRelayPlugin()],
  root: '.',
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: {
    outDir: 'dist',
  },
});
