import Dexie from 'dexie';
import type { Table } from 'dexie';
import { parseProject, serializeProject } from '@archguide/core';
import type { Project } from '@archguide/core';

/** One row per project; the project itself is stored in its canonical JSON form (§7.4). */
export interface StoredProject {
  id: string;
  name: string;
  updatedAt: string;
  json: string;
}

class ArchGuideDb extends Dexie {
  projects!: Table<StoredProject, string>;

  constructor() {
    super('archguide');
    this.version(1).stores({ projects: 'id, name, updatedAt' });
  }
}

export const db = new ArchGuideDb();

export async function listProjects(): Promise<StoredProject[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const row = await db.projects.get(id);
  return row ? parseProject(row.json) : undefined;
}

/** Saves a project with a new revision and timestamp, and returns the saved version. */
export async function saveProject(project: Project): Promise<Project> {
  const saved: Project = {
    ...project,
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await db.projects.put({
    id: saved.id,
    name: saved.name,
    updatedAt: saved.updatedAt,
    json: serializeProject(saved),
  });
  return saved;
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}
