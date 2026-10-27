import { describe, expect, it } from 'vitest';
import { serializeProject } from '@archguide/core';
import { sampleProject } from '../lib/sample';
import { FolderStore } from './folder';
import type { DirectoryLike, FileLike } from './folder';

/** An in-memory folder with the File System Access API calls the store uses. */
class MemoryDir implements DirectoryLike {
  readonly files = new Map<string, string>();
  readonly dirs = new Map<string, MemoryDir>();
  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!options.create) throw new Error(`NotFoundError: ${name}`);
      dir = new MemoryDir(name);
      this.dirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FileLike> {
    if (!this.files.has(name)) {
      if (!options.create) throw new Error(`NotFoundError: ${name}`);
      this.files.set(name, '');
    }
    return {
      getFile: async () => ({ text: async () => this.files.get(name) ?? '' }),
      createWritable: async () => {
        let buffer = '';
        return {
          write: async (data: string) => void (buffer += data),
          close: async () => void this.files.set(name, buffer),
        };
      },
    };
  }

  async removeEntry(name: string) {
    this.files.delete(name);
    this.dirs.delete(name);
  }

  async *entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]> {
    for (const name of this.files.keys()) yield [name, { kind: 'file' }];
    for (const name of this.dirs.keys()) yield [name, { kind: 'directory' }];
  }
}

const NOW = '2026-10-27T00:00:00.000Z';

describe('folder mode', () => {
  it('saves a project to a folder and reopens it identically', async () => {
    const repo = new MemoryDir('shop-repo');
    await repo.getDirectoryHandle('architecture', { create: true });
    const p = sampleProject('shop', NOW);

    const first = new FolderStore();
    await first.open(repo);
    expect(first.name).toBe('shop-repo');
    await first.writeProject(p);
    const architecture = repo.dirs.get('architecture')!;
    expect([...architecture.files.keys()].sort()).toEqual([
      'archguide.config.json',
      'shop.archguide.json',
    ]);
    expect(JSON.parse(architecture.files.get('archguide.config.json')!)).toMatchObject({
      profile: 'react-node-postgres',
      defaultProject: 'shop',
    });

    // Another session opens the same folder.
    const second = new FolderStore();
    await second.open(repo);
    expect(second.config.defaultProject).toBe('shop');
    expect(await second.listProjects()).toEqual([
      { id: 'shop', name: p.name, file: 'shop.archguide.json' },
    ]);
    expect(serializeProject(await second.readProject('shop'))).toBe(serializeProject(p));
  });

  it('uses the picked folder itself when it has no architecture folder', async () => {
    const dir = new MemoryDir('architecture-notes');
    const store = new FolderStore();
    await store.open(dir);
    await store.writeProject(sampleProject('notes', NOW));
    expect(dir.files.has('notes.archguide.json')).toBe(true);
  });

  it('keeps snapshots under .archguide/snapshots/<project>/', async () => {
    const dir = new MemoryDir('repo');
    const store = new FolderStore();
    await store.open(dir);
    const p = sampleProject('shop', NOW);
    await store.writeProject(p);
    await store.writeSnapshot('shop', 'snap-1', serializeProject(p));
    expect(
      dir.dirs.get('.archguide')?.dirs.get('snapshots')?.dirs.get('shop')?.files.has('snap-1.json'),
    ).toBe(true);
    expect((await store.readSnapshot('shop', 'snap-1'))?.id).toBe('shop');
    await store.deleteSnapshot('shop', 'snap-1');
    expect(await store.readSnapshot('shop', 'snap-1')).toBeUndefined();
    // Projects that are not in the folder get no snapshot files.
    await store.writeSnapshot('other', 'snap-2', '{}');
    expect(dir.dirs.get('.archguide')?.dirs.get('snapshots')?.dirs.has('other')).toBe(false);
  });

  it('skips files that are not projects, and reports a broken config', async () => {
    const dir = new MemoryDir('repo');
    dir.files.set('notes.archguide.json', 'not json');
    const store = new FolderStore();
    await store.open(dir);
    expect(await store.listProjects()).toEqual([]);
    dir.files.set('archguide.config.json', '{');
    await expect(new FolderStore().open(dir)).rejects.toThrow(/not valid JSON/);
  });
});
