# `@athlete/eslint-config`

Three flat configs, consumed by each workspace package through its own
`eslint.config.mjs`.

| Entry point | Use for | What it adds |
|---|---|---|
| `@athlete/eslint-config/base` | plain JS at the repository root | `eslint:recommended`, `typescript-eslint` syntax rules, unused-variable policy |
| `@athlete/eslint-config/nest` | `apps/api`, `packages/*` | the above **plus** type-aware rules via `projectService` |
| `@athlete/eslint-config/react` | `apps/web` | the type-aware tier for the browser: the same promise rules, plus the two React hook rules |

## Why the type-aware tier is not optional

`apps/api` asserts authorization with promise-returning calls that are awaited for
their effect rather than their value. Removing an `await` from one of them leaves code
that type-checks, returns 200, and skips the check — the rejection surfaces as an
unhandled promise after the response is already on the wire, so no test can observe it.
`@typescript-eslint/no-floating-promises` is the only tool in this repository that
catches that class of defect, and it cannot run without type information.

That is the whole argument for the cost: `projectService` makes lint noticeably slower
than a syntax-only pass, and it is worth it for exactly one reason.

## Consuming it

```js
// apps/api/eslint.config.mjs
import { config } from '@athlete/eslint-config/nest';

export default [
  ...config,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
];
```

`tsconfigRootDir` must be set by the consumer — that is how `projectService` finds the
package's own `tsconfig.json` rather than whichever one happens to sit above the
process's working directory.

## House rules

- **Errors, never warnings.** A warning passes CI, so a rule that is only worth a
  warning is not worth enabling. Enable it as an error or leave it off.
- **Exemptions are local and commented.** Turn a rule off in the package that needs it
  off, next to a sentence saying why — not here, where it would silently widen to every
  package.
