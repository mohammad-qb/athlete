import { config } from '@athlete/eslint-config/react';

export default [
  ...config,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // TanStack Router's control flow: a guard or loader leaves by THROWING the value
      // `redirect()` or `notFound()` returns, which the router catches. Those two are
      // allowed by type; throwing anything else that is not an Error stays an error.
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [
            { from: 'package', package: '@tanstack/router-core', name: ['Redirect', 'NotFoundError'] },
          ],
        },
      ],
    },
  },
  {
    // Generated, committed, never edited by hand: the API client (hey-api, checked for
    // drift in CI) and the route tree (TanStack Router's Vite plugin).
    ignores: [
      'src/lib/api/generated/**',
      'src/routeTree.gen.ts',
      'dist/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
];
