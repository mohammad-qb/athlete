import { config } from '@athlete/eslint-config/base';

/**
 * Root-level files only. Every workspace package carries its own flat config so that
 * `projectService` resolves against the package's own tsconfig -- see
 * tooling/eslint-config/README.md. This config covers what is left: the repository's
 * plain JS (hook and lint configuration, the dev token minter).
 *
 * `pnpm run lint` runs this pass and every package's pass.
 */
export default [
  ...config,
  {
    // The root package declares no "type": "module", so a bare .js file here is
    // CommonJS and `require` is its only import form. The rule exists to keep ESM
    // TypeScript sources from reaching for `require`; applied to genuine CommonJS it
    // reports the language rather than a defect.
    files: ['**/*.{js,cjs}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    ignores: ['apps/**', 'packages/**', 'tooling/**', 'infra/**', 'node_modules/**'],
  },
];
