// Bundles the two binaries into dist/ with the skill and, when built, the web app (§22).
import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = join(here, '..', '..');
const dist = join(here, 'dist');

await rm(dist, { recursive: true, force: true });
await build({
  entryPoints: {
    archguide: join(here, 'src', 'bin.ts'),
    'archguide-mcp': join(repo, 'packages', 'mcp-server', 'src', 'bin.ts'),
  },
  outdir: dist,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  // Optional native speed-ups of ws; it works without them. The analyzer's engines load
  // files next to their own code (WebAssembly, TypeScript's lib files), so they stay
  // packages and are installed with the CLI.
  external: [
    'bufferutil',
    'utf-8-validate',
    'pg-native',
    'typescript',
    'dependency-cruiser',
    'libpg-query',
    'pg',
  ],
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'warning',
});

await mkdir(join(dist, 'skills', 'archguide'), { recursive: true });
await cp(
  join(repo, 'skills', 'archguide', 'SKILL.md'),
  join(dist, 'skills', 'archguide', 'SKILL.md'),
);
const web = join(repo, 'apps', 'web', 'dist');
if (existsSync(join(web, 'index.html'))) await cp(web, join(dist, 'web'), { recursive: true });
else console.warn('apps/web/dist is missing: run "pnpm --filter @archguide/web build" first.');
