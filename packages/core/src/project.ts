import { SCHEMA_VERSION } from './schema';
import type { Id, Project, ProjectSettings } from './schema';

export const DEFAULT_THRESHOLDS: ProjectSettings['thresholds'] = {
  fanOut: 8,
  fanIn: 8,
  syncDepth: 4,
  frontendDirectServices: 2,
};

export interface NewProjectInput {
  id: Id;
  name: string;
  profile: string;
  description?: string;
  rulePacks?: string[];
  /** ISO timestamp; defaults to now. */
  now?: string;
}

/** A new, empty project with one free view called "Main". */
export function createProject(input: NewProjectInput): Project {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    id: input.id,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    profile: input.profile,
    createdAt: now,
    updatedAt: now,
    model: { elements: [], relations: [] },
    views: [{ id: 'main', name: 'Main', kind: 'free', nodes: [], edges: [], annotations: [] }],
    notes: [],
    decisions: [],
    tours: [],
    changeSets: [],
    snapshots: [],
    settings: {
      rulePacks: input.rulePacks ?? ['core'],
      ruleOverrides: {},
      suppressions: [],
      thresholds: { ...DEFAULT_THRESHOLDS },
    },
  };
}
