import tseslint from 'typescript-eslint';
import { config as baseConfig } from './base.js';

/**
 * Type-aware configuration for the TypeScript packages (apps/api, packages/*).
 *
 * WHY THIS EXISTS, concretely. Authorization in this codebase WAS asserted by calls
 * that return a promise and are awaited for effect, not for value:
 *
 *     await this.policies.assertCanAccessAthlete(id);
 *
 * (That call is gone: resource checks are now a synchronous `assertCan` and a required
 * repository filter, neither of which has a promise to drop. The rule stays, because
 * the shape -- an awaited call made only for its side effect -- is how the next such
 * check will be written.)
 *
 * Drop the `await` and the expression still type-checks, the request still succeeds,
 * and the check is silently skipped -- there is no value for a test to assert on and no
 * exception to observe, because the rejection lands in an unhandled promise after the
 * response has been written. That is an authorization bypass introduced by deleting six
 * characters. `no-floating-promises` is the only thing in the toolchain that catches it,
 * and it is unavailable without type information, which is why `projectService` is on
 * and why this config is a build gate rather than an editor nicety.
 *
 * `no-misused-promises` covers the same mistake in its other shapes (an async function
 * passed where a sync predicate is expected, a promise used as a condition -- always
 * truthy). `require-await` catches the inverse: a function marked `async` that awaits
 * nothing, which usually means an await was removed and the keyword left behind.
 *
 * All three are already errors in `recommendedTypeChecked`. They are restated here
 * because they are load-bearing: a preset change upstream must not quietly downgrade
 * them, and a reader should be able to see the guarantee without resolving a preset.
 *
 * Consumers set `tsconfigRootDir` in their own flat config so `projectService` resolves
 * the right tsconfig:
 *
 *     import { config } from '@athlete/eslint-config/nest';
 *     export default [
 *       ...config,
 *       { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
 *     ];
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  ...baseConfig,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      sourceType: 'module',
      parserOptions: {
        // Resolves each file through the nearest tsconfig via the TypeScript language
        // service. `allowDefaultProject` covers the two tool configs that deliberately
        // sit outside the build (drizzle.config.ts imports drizzle-kit, a CLI that is
        // not an application dependency; vitest.config.ts is likewise test-runner
        // configuration). Without this they would be lint errors for being absent from
        // every project, and ignoring them would leave real files unlinted.
        projectService: {
          allowDefaultProject: ['*.config.ts'],
        },
      },
    },
    rules: {
      // The three rules this gate exists for. See the header.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',

      // Nest modules and controllers are decorator-only classes by design.
      '@typescript-eslint/no-extraneous-class': 'off',

      // Decorator metadata (`Reflect.getMetadata`) and the Drizzle query builder
      // resolve to `any` at too many call sites for this family to carry signal. The
      // rest of recommendedTypeChecked -- notably the promise rules above -- stays on.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Flat-config and tool files are plain JS and belong to no tsconfig: type-aware
    // rules cannot run on them and would error if they tried.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
];
