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
        pathNot: '(\\.repository\\.ts$|src/db/|src/common/tenancy/database\\.service\\.ts$)',
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
    // ---- apps/web --------------------------------------------------------------
    // The SPA's structure: thin routes over self-contained features over shared
    // components and lib. These rules are what "a feature can be read, changed and
    // deleted by itself" means in practice; the last three are the direction itself
    // (routes -> features -> components -> lib), one rule per layer that has one above.
    {
      name: 'web-no-cross-feature',
      comment:
        'A feature never imports another feature, not even through its index. What two ' +
        'features both need belongs in components/ or lib/ (a shared picker, a query), ' +
        'so that neither feature has to be understood to change the other.',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: {
        path: '^apps/web/src/features/([^/]+)/',
        pathNot: '^apps/web/src/features/$1/',
      },
    },
    {
      name: 'web-feature-only-through-index',
      comment:
        "Code outside a feature imports it only through the feature's index.ts. The " +
        'index is the public surface; everything else in the folder is free to change.',
      severity: 'error',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/features/' },
      to: {
        path: '^apps/web/src/features/[^/]+/',
        pathNot: '^apps/web/src/features/[^/]+/index\\.ts$',
      },
    },
    {
      name: 'web-ui-stays-primitive',
      comment:
        'components/ui holds shadcn primitives: presentation only. A primitive that ' +
        'knows a feature, a route or the API client is no longer one.',
      severity: 'error',
      from: { path: '^apps/web/src/components/ui/' },
      to: { path: '^apps/web/src/(features|routes|lib/api)/' },
    },
    {
      name: 'web-lib-stays-below',
      comment:
        'lib is the bottom layer of the SPA (API client, error mapper, auth, can). It ' +
        'must not reach up into a component, a feature or a route; what it needs from ' +
        'above is injected (see configureErrorMapper).',
      severity: 'error',
      from: { path: '^apps/web/src/lib/' },
      to: { path: '^apps/web/src/(components|features|routes)/' },
    },
    {
      name: 'web-components-stay-below',
      comment:
        'components are shared by every feature, so they know none of them: a shared ' +
        'composite takes what is feature-specific as props, and never imports a ' +
        'feature (not even its index) or a route.',
      severity: 'error',
      from: { path: '^apps/web/src/components/' },
      to: { path: '^apps/web/src/(features|routes)/' },
    },
    {
      name: 'web-features-stay-below-routes',
      comment:
        'A route renders a feature page, never the reverse. A feature that imports a ' +
        'route is tied to one URL; it takes search params and navigation as props.',
      severity: 'error',
      from: { path: '^apps/web/src/features/' },
      to: { path: '^apps/web/src/routes/' },
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
