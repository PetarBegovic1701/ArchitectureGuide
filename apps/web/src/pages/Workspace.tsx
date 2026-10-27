import { useCallback, useEffect, useRef, useState } from 'react';
import { createProject, slugify, uniqueId } from '@archguide/core';
import { DEFAULT_PROFILE } from '../lib/catalog';
import { sampleProject } from '../lib/sample';
import { readProjectFile } from '../actions';
import { deleteProject, listProjects, loadProject, saveProject } from '../persistence/db';
import type { StoredProject } from '../persistence/db';
import { navigate } from '../hooks';
import { useUi } from '../store/ui';

/** Project list: create, open, import, duplicate, delete (§14.4). */
export function Workspace() {
  const [projects, setProjects] = useState<StoredProject[] | null>(null);
  const [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useUi((s) => s.toast);

  const refresh = useCallback(async () => setProjects(await listProjects()), []);
  useEffect(() => void refresh(), [refresh]);

  const freeId = (base: string) =>
    uniqueId(slugify(base), new Set((projects ?? []).map((p) => p.id)));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const projectName = name.trim() || 'Untitled architecture';
    const project = createProject({
      id: freeId(projectName),
      name: projectName,
      profile: DEFAULT_PROFILE,
    });
    await saveProject(project);
    navigate({ page: 'editor', projectId: project.id });
  };

  const createSample = async () => {
    const project = sampleProject(freeId('starter'));
    await saveProject(project);
    navigate({ page: 'editor', projectId: project.id });
  };

  const importFile = async (file: File) => {
    try {
      const project = await readProjectFile(file);
      const id = freeId(project.id);
      await saveProject({ ...project, id });
      toast({ tone: 'success', message: `Imported “${project.name}”.` });
      await refresh();
    } catch (error) {
      toast({
        tone: 'error',
        message: `This file is not a valid ArchitectureGuide project: ${(error as Error).message}`,
      });
    }
  };

  const duplicate = async (id: string) => {
    const project = await loadProject(id);
    if (!project) return;
    await saveProject({
      ...project,
      id: freeId(`${project.id}-copy`),
      name: `${project.name} (copy)`,
    });
    await refresh();
  };

  const remove = async (p: StoredProject) => {
    if (!window.confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
    await deleteProject(p.id);
    await refresh();
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">ArchitectureGuide</h1>
        <p className="text-[var(--ag-muted)]">
          Learn, plan and explain software architecture on one canvas — for React, Node.js and
          PostgreSQL.
        </p>
      </header>

      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <form
          onSubmit={create}
          className="rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-4"
        >
          <h2 className="mb-2 font-semibold">New project</h2>
          <label htmlFor="new-name" className="mb-1 block text-xs text-[var(--ag-muted)]">
            Name
          </label>
          <input
            id="new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Shop"
            className="mb-3 w-full rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-2 py-1 outline-none focus:border-[var(--ag-accent)]"
          />
          <button
            type="submit"
            className="rounded bg-[var(--ag-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--ag-accent-text)]"
          >
            Create
          </button>
        </form>
        <div className="rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-4">
          <h2 className="mb-2 font-semibold">New to this?</h2>
          <p className="mb-3 text-sm text-[var(--ag-muted)]">
            Open a ready-made starter: a React app, a Node.js API and a PostgreSQL database. Click
            any shape and open the Learn tab.
          </p>
          <button
            type="button"
            onClick={createSample}
            className="rounded border border-[var(--ag-border)] px-3 py-1.5 text-sm font-semibold"
          >
            Open the starter
          </button>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Your projects</h2>
          <div className="flex gap-3 text-sm">
            <button
              type="button"
              className="text-[var(--ag-accent)] hover:underline"
              onClick={() => fileInput.current?.click()}
            >
              Import JSON…
            </button>
            <a className="text-[var(--ag-accent)] hover:underline" href="#/gallery">
              Shape gallery
            </a>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Import project file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {projects === null ? (
          <p className="text-sm text-[var(--ag-muted)]">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-[var(--ag-muted)]">
            No projects yet. Projects are saved in this browser.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--ag-border)] rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)]">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2">
                <a
                  className="flex-1 font-medium hover:underline"
                  href={`#/p/${encodeURIComponent(p.id)}`}
                >
                  {p.name}
                </a>
                <span className="text-xs text-[var(--ag-muted)]">
                  {new Date(p.updatedAt).toLocaleString()}
                </span>
                <button
                  type="button"
                  className="text-xs text-[var(--ag-accent)]"
                  onClick={() => duplicate(p.id)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="text-xs text-[var(--ag-error)]"
                  onClick={() => remove(p)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
