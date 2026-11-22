import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { config as baseConfig } from './base.js';

/**
 * Type-aware configuration for the browser application (apps/web).
 *
 * The same tier as ./nest.js, for the same reason, in its browser form. An event
 * handler or an effect that starts a request and drops the promise type-checks, works
 * on the happy path, and turns every failure into an unhandled rejection: the error
 * mapper never runs, so the person sees nothing and the form looks saved.
 * `no-floating-promises` and `no-misused-promises` are what catch that, and neither
 * can run without type information. A deliberate fire-and-forget is written `void
 * promise`, which is the reviewable form of the same decision.
 *
 * On top of that, the two hook rules that are correctness rather than style: hooks
 * called conditionally, and effects whose dependency list has drifted from their body.
 *
 * Unlike ./nest.js this does not allow a default project: apps/web's tsconfig includes
 * its own tool configs (vite, vitest, playwright), so every linted file has a project.
 *
 * Consumers set `tsconfigRootDir` in their own flat config, as with ./nest.js.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  ...baseConfig,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { projectService: true },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The rules this gate exists for. See the header and ./nest.js.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Flat-config and tool files in plain JS belong to no tsconfig: type-aware rules
    // cannot run on them and would error if they tried.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
];
