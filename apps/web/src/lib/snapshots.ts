import { diffProjects, serializeProject } from '@archguide/core';
import type { Project, SnapshotRef } from '@archguide/core';
import type { CompareState } from '../store/ui';
import { deleteSnapshot, loadSnapshot, saveProject, saveSnapshot } from '../persistence/db';
import { folder } from '../persistence/folder';

/** Saves a named full copy of the project and returns its reference (§14.4). */
export async function createSnapshot(p: Project, name: string): Promise<SnapshotRef> {
  const ref: SnapshotRef = {
    id: `snap-${Date.now().toString(36)}`,
    name: name.trim() || `Revision ${p.revision}`,
    revision: p.revision,
    createdAt: new Date().toISOString(),
  };
  const json = serializeProject({ ...p, snapshots: [] });
  await saveSnapshot({ ...ref, projectId: p.id, json });
  await folder.writeSnapshot(p.id, ref.id, json);
  return ref;
}

export async function removeSnapshot(p: Project, id: string): Promise<SnapshotRef[]> {
  await deleteSnapshot(id);
  await folder.deleteSnapshot(p.id, id);
  return p.snapshots.filter((s) => s.id !== id);
}

async function snapshotProject(p: Project, id: string): Promise<Project | undefined> {
  return (await loadSnapshot(id)) ?? (await folder.readSnapshot(p.id, id));
}

/**
 * The project as it was in a snapshot, keeping the current ID, name and snapshot list.
 * The current state is saved as a snapshot first, so a restore can itself be undone.
 */
export async function restoreSnapshot(p: Project, ref: SnapshotRef): Promise<Project> {
  const old = await snapshotProject(p, ref.id);
  if (!old) throw new Error(`The snapshot “${ref.name}” could not be read.`);
  const backup = await createSnapshot(p, `Before restoring “${ref.name}”`);
  const restored: Project = {
    ...old,
    id: p.id,
    name: p.name,
    revision: p.revision,
    snapshots: [...p.snapshots, backup],
  };
  return saveProject(restored);
}

/** What changed since a snapshot, for the canvas overlay. */
export async function compareWith(p: Project, ref: SnapshotRef): Promise<CompareState> {
  const old = await snapshotProject(p, ref.id);
  if (!old) throw new Error(`The snapshot “${ref.name}” could not be read.`);
  const d = diffProjects(old, p);
  const name = (id: string) => {
    const el = old.model.elements.find((e) => e.id === id);
    if (el) return el.name;
    const r = old.model.relations.find((x) => x.id === id);
    const end = (x: string) => old.model.elements.find((e) => e.id === x)?.name ?? x;
    return r ? `${end(r.sourceId)} ${r.type} ${end(r.targetId)}` : id;
  };
  return {
    snapshotName: ref.name,
    createdAt: ref.createdAt,
    added: new Set([...d.added.elements, ...d.added.relations]),
    changed: new Set(d.changed.map((c) => c.id)),
    removed: [...d.removed.elements, ...d.removed.relations].map((id) => ({ id, name: name(id) })),
  };
}
