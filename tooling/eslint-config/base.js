import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Syntax-level configuration, shared by every workspace package.
 *
 * Nothing here needs type information, so it also applies to the plain JS at the
 * repository root (eslint.config.mjs, commitlint.config.mjs, scripts/*.js). The rules
 * that actually catch the defects this repository cares about are type-aware and live
 * in ./nest.js -- this file exists so those two concerns are separable.
 *
 * Violations are errors, never warnings. A warning in a monorepo lint run is a line of
 * output nobody reads; CI treats it as a pass. If a rule is not worth failing a build
 * over, it should not be enabled.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // A `_` prefix marks a binding as deliberately unused (an ignored catch
      // parameter, a positional argument kept for signature shape). Everything
      // unprefixed stays red, so a genuinely dead variable is not noise.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**'],
  },
];
