import Dexie from 'dexie';
import type { Table } from 'dexie';
import { parseProject, parseTemplateFile, serializeProject } from '@archguide/core';
import type { Project, TemplateFile } from '@archguide/core';

/** One row per project; the project itself is stored in its canonical JSON form (§7.4). */
export interface StoredProject {
  id: string;
  name: string;
  updatedAt: string;
  json: string;
}

/** A template saved from a selection, as its file JSON. */
export interface StoredTemplate {
  id: string;
  name: string;
  createdAt: string;
  json: string;
}

/** A named full copy of a project at a revision (§14.4). */
export interface StoredSnapshot {
  id: string;
  projectId: string;
  name: string;
  revision: number;
  createdAt: string;
  json: string;
}

/** A folder opened with the File System Access API, kept so it can be reopened (§14.1). */
export interface StoredHandle {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  openedAt: string;
}

class ArchGuideDb extends Dexie {
  projects!: Table<StoredProject, string>;
  templates!: Table<StoredTemplate, string>;
  snapshots!: Table<StoredSnapshot, string>;
  handles!: Table<StoredHandle, string>;

  constructor() {
    super('archguide');
    this.version(1).stores({ projects: 'id, name, updatedAt' });
    this.version(2).stores({
      projects: 'id, name, updatedAt',
      templates: 'id, name, createdAt',
      snapshots: 'id, projectId, createdAt',
      handles: 'id, openedAt',
    });
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
  await db.transaction('rw', db.projects, db.snapshots, async () => {
    await db.projects.delete(id);
    await db.snapshots.where('projectId').equals(id).delete();
  });
}

// --- templates ----------------------------------------------------------------

export async function listTemplates(): Promise<TemplateFile[]> {
  const rows = await db.templates.orderBy('createdAt').reverse().toArray();
  return rows.flatMap((r) => {
    try {
      return [parseTemplateFile(r.json)];
    } catch {
      return []; // a damaged row must not hide the others
    }
  });
}

export async function saveTemplate(file: TemplateFile): Promise<void> {
  await db.templates.put({
    id: file.id,
    name: file.name,
    createdAt: file.createdAt ?? new Date().toISOString(),
    json: JSON.stringify(file),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.templates.delete(id);
}

// --- snapshots ----------------------------------------------------------------

export async function listSnapshots(projectId: string): Promise<StoredSnapshot[]> {
  return db.snapshots.where('projectId').equals(projectId).reverse().sortBy('createdAt');
}

export async function saveSnapshot(row: StoredSnapshot): Promise<void> {
  await db.snapshots.put(row);
}

export async function loadSnapshot(id: string): Promise<Project | undefined> {
  const row = await db.snapshots.get(id);
  return row ? parseProject(row.json) : undefined;
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.snapshots.delete(id);
}
