import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // Integration tests each own a Postgres container; running them in one fork keeps
    // container count (and CI memory) predictable.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 180_000,
    testTimeout: 180_000,
  },
});
