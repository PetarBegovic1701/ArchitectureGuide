// Package boundaries of this monorepo (Implementation.md §4.2).
// Hand-written for now. From Phase 7 on, `archguide generate dependency-cruiser`
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
      name: 'workspace-only-core',
      comment: 'packages/workspace (Node file IO) MAY import only packages/core.',
      severity: 'error',
      from: { path: '^packages/workspace/' },
      to: { path: '^(packages/(?!core/|workspace/)|apps/)' },
    },
    {
      name: 'server-allowed',
      comment: 'packages/server MAY import core and workspace.',
      severity: 'error',
      from: { path: '^packages/server/' },
      to: { path: '^(packages/(?!core/|workspace/|server/)|apps/)' },
    },
    {
      name: 'mcp-allowed',
      comment: 'packages/mcp-server MAY import core, workspace, profiles and analyzer.',
      severity: 'error',
      from: { path: '^packages/mcp-server/' },
      to: { path: '^(packages/(cli|server)/|apps/)' },
    },
    {
      name: 'cli-no-web',
      comment: 'packages/cli serves the built web app; it MUST NOT import its sources.',
      severity: 'error',
      from: { path: '^packages/cli/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-no-node-packages',
      comment:
        'apps/web MUST NOT import analyzer, workspace, server, cli or mcp-server (its e2e tests drive the server).',
      severity: 'error',
      from: { path: '^apps/web/', pathNot: '^apps/web/e2e/' },
      to: { path: '^packages/(analyzer|workspace|server|cli|mcp-server)/' },
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
      comment:
        'Runtime import cycles. Cycles made only of type imports are erased at compile time.',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
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
      extensions: ['.ts', '.tsx', '.js'],
    },
  },
};
