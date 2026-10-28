import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Exit codes (Implementation.md §22). */
export const EXIT = { ok: 0, findings: 1, usage: 2, internal: 3 } as const;

/** A usage or config problem: printed without a stack trace, exit code 2. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = EXIT.usage,
  ) {
    super(message);
  }
}

/** Where commands read and write, so tests can run them in-process. */
export interface Io {
  cwd: string;
  out(text: string): void;
  err(text: string): void;
  /** Ends long-running commands (serve); they also stop on SIGINT and SIGTERM. */
  signal?: AbortSignal;
  /** Colors on stdout. */
  color?: boolean;
}

export const processIo = (): Io => ({
  cwd: process.cwd(),
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  color: process.stdout.isTTY,
});

/**
 * Finds a file shipped with the CLI: next to the bundle (dist/web, dist/skills) or, when
 * running from the sources, in the repository (apps/web/dist, skills/).
 */
export function findAsset(...candidates: string[]): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    for (const c of candidates) if (existsSync(join(dir, c))) return join(dir, c);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
