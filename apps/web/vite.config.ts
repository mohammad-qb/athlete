import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * A static SPA. In development the dev server proxies `/api` to the API, so the browser
 * sees ONE origin exactly as it does behind Front Door in production: the session
 * cookie is first-party and there is no CORS anywhere.
 */
export default defineConfig({
  plugins: [
    // Must come before the React plugin: it generates src/routeTree.gen.ts from
    // src/routes and splits each route's component into its own chunk.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // The contracts package is built to CommonJS for the API. Bundling that output
      // would pull in a second, un-tree-shakeable copy of Zod beside the one this app
      // imports, so the bundler reads the package's TypeScript source instead. Types
      // still come from its built declarations (`tsc` does not read this alias).
      '@athlete/contracts': path.resolve(
        import.meta.dirname,
        '../../packages/contracts/src/index.ts',
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
