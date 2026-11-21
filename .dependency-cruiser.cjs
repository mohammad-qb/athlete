/**
 * Architecture fitness rules.
 *
 * The layered module design is only a design until something enforces it. These rules
 * run in CI, so "maintainable as it grows" is a check a reviewer can execute rather
 * than a claim they have to take on trust -- and the answer to "how does this survive
 * two more hires?" is: the build stops them.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-controller-to-repository',
      comment:
        'Controllers must go through an application service. A controller touching a ' +
        'repository bypasses the transaction boundary and the policy checks that live there.',
      severity: 'error',
      from: { path: 'apps/api/src/modules/[^/]+/.+\\.controller\\.ts$' },
      to: { path: '\\.repository\\.ts$' },
    },
    {
      name: 'no-repository-to-service',
      comment: 'Repositories are the bottom layer. Depending upwards inverts the design.',
      severity: 'error',
      from: { path: '\\.repository\\.ts$' },
      to: { path: '\\.(service|controller)\\.ts$' },
    },
    {
      name: 'no-cross-module-internals',
      comment:
        'A feature module may depend on another module only through its public service ' +
        'or its module file -- never by reaching into a sibling controller or repository. ' +
        'This is the rule that keeps the modules extractable later.',
      severity: 'error',
      from: { path: 'apps/api/src/modules/([^/]+)/' },
      to: {
        path: 'apps/api/src/modules/([^/]+)/.+\\.(controller)\\.ts$',
        pathNot: 'apps/api/src/modules/$1/',
      },
    },
    {
      name: 'no-sql-outside-repositories',
      comment:
        'Drizzle schema tables may only be imported by repositories (and the migration ' +
        'runner). This is what makes an unscoped, non-RLS query structurally impossible ' +
        'rather than merely discouraged.',
      severity: 'error',
      from: {
        path: 'apps/api/src/',
        // Three deliberate exceptions, each justified rather than convenient:
        //  - *.repository.ts      the sanctioned data-access layer
        //  - src/db/              the schema and migration runner themselves
        //  - tenancy/database.*   infrastructure: it types the Drizzle client
        //  - policy.service.ts    owns its own authorization reads, because routing
        //                         them through feature repositories would make the
        //                         common layer depend on feature modules -- a worse
        //                         coupling than the one it would remove.
        pathNot:
          '(\\.repository\\.ts$|src/db/|src/common/tenancy/database\\.service\\.ts$|policy\\.service\\.ts$)',
      },
      to: { path: 'apps/api/src/db/schema\\.ts$' },
    },
    {
      name: 'contracts-stay-pure',
      comment:
        'packages/contracts is shared with the browser client. It must not pull in Nest, ' +
        'the database, or anything server-only.',
      severity: 'error',
      from: { path: 'packages/contracts/' },
      to: { path: 'node_modules/(@nestjs|drizzle-orm|pg)/' },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies make modules impossible to extract or reason about.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|/test/)' },
    tsPreCompilationDeps: true,
    // Self-contained: dependency-cruiser resolves `extends` against cwd, not the file.
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['require', 'node'] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
