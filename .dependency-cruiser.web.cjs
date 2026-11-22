/**
 * The same rules as .dependency-cruiser.cjs, resolved the way apps/web is built.
 *
 * One rule set, two resolutions: the API is CommonJS with Node resolution, the SPA is
 * bundled ES modules with a `@/` path alias and TSX. dependency-cruiser takes a single
 * tsconfig per run, so `pnpm run lint:boundaries` runs it once with each.
 */
module.exports = {
  extends: './.dependency-cruiser.cjs',
  options: {
    // The generated API client is hey-api's code, not ours to arrange: its two
    // runtime files import each other's types. Everything written by hand is checked.
    exclude: { path: '(node_modules|dist|/test/|apps/web/src/lib/api/generated/)' },
    // Self-contained and at the root, like tsconfig.depcruise.json: dependency-cruiser
    // reads a tsconfig relative to the working directory, not to the file.
    tsConfig: { fileName: 'tsconfig.depcruise.web.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'browser', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.css'],
    },
  },
};
