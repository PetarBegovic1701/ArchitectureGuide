import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileIndex } from './engines/ts-index';

/** Bump when FileIndex changes, so old caches are ignored. */
const CACHE_VERSION = 1;

interface CacheFile {
  version: number;
  files: Record<string, { hash: string; index: FileIndex }>;
}

export const hashText = (text: string) => createHash('sha1').update(text).digest('hex');

/**
 * File hash → index, in `.archguide/analysis/cache/` (Implementation.md §19.8): a second
 * run parses only the files that changed.
 */
export class IndexCache {
  private data: CacheFile = { version: CACHE_VERSION, files: {} };
  private used = new Set<string>();
  hits = 0;

  private constructor(private readonly path: string | undefined) {}

  static async open(dir: string | undefined): Promise<IndexCache> {
    const cache = new IndexCache(dir ? join(dir, 'index.json') : undefined);
    if (!cache.path) return cache;
    try {
      const data = JSON.parse(await readFile(cache.path, 'utf8')) as CacheFile;
      if (data.version === CACHE_VERSION) cache.data = data;
    } catch {
      // no cache yet
    }
    return cache;
  }

  get(file: string, hash: string): FileIndex | undefined {
    const hit = this.data.files[file];
    this.used.add(file);
    if (hit?.hash !== hash) return undefined;
    this.hits++;
    return hit.index;
  }

  set(file: string, hash: string, index: FileIndex) {
    this.used.add(file);
    this.data.files[file] = { hash, index };
  }

  /** Writes the cache, without entries for files that are gone. */
  async save(): Promise<void> {
    if (!this.path) return;
    const files: CacheFile['files'] = {};
    for (const f of [...this.used].sort()) if (this.data.files[f]) files[f] = this.data.files[f]!;
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    await writeFile(temp, JSON.stringify({ version: CACHE_VERSION, files }));
    await rename(temp, this.path);
  }
}
