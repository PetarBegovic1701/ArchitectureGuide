// Package boundaries of this monorepo (Implementation.md §4.2).
// Hand-written for now. From Phase 6 on, `archguide generate dependency-cruiser`
// produces it from architecture/archguide.archguide.json.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-is-standalone',
      comment: 'packages/core MUST NOT import any other workspace package.',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^(packages/(?!core/)|apps/)' },
    },
    {
      name: 'core-no-node-builtins',
      comment: 'packages/core/src runs in the browser too: no Node built-ins.',
      severity: 'error',
      from: { path: '^packages/core/src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'profiles-only-core',
      comment: 'Profiles MAY import only packages/core.',
      severity: 'error',
      from: { path: '^packages/profiles/' },
      to: { path: '^(packages/(?!core/|profiles/)|apps/)' },
    },
    {
      name: 'analyzer-allowed',
      severity: 'error',
      from: { path: '^packages/analyzer/' },
      to: { path: '^(packages/(server|cli|mcp-server)/|apps/)' },
    },
    {
      name: 'server-only-core',
      severity: 'error',
      from: { path: '^packages/server/' },
      to: { path: '^(packages/(?!core/|server/)|apps/)' },
    },
    {
      name: 'mcp-no-cli-server-web',
      severity: 'error',
      from: { path: '^packages/mcp-server/' },
      to: { path: '^(packages/(cli|server)/|apps/)' },
    },
    {
      name: 'web-no-node-packages',
      comment: 'apps/web MUST NOT import analyzer, server, cli or mcp-server.',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^packages/(analyzer|server|cli|mcp-server)/' },
    },
    {
      name: 'no-unresolvable',
      comment: 'Every import must resolve, so the rules above cannot be bypassed by accident.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|\\.test\\.ts$)' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    // Workspace packages export TypeScript sources through package.json "exports".
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
      extensions: ['.ts', '.js'],
    },
  },
};
