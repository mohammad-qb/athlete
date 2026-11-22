import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Unit tests: logic and components in jsdom, with the app's own Vite config (aliases,
 * the router plugin, JSX). The flows through a real browser and the real API are
 * Playwright's, under e2e/, and are not collected here.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
      globals: false,
      restoreMocks: true,
    },
  }),
);
