import type { Catalog } from '../catalog';
import type { Level } from '../learn/schema';
import type { Id } from '../schema';

export const EXPORT_FORMATS = [
  'json',
  'agent-md',
  'agent-yaml',
  'agents-snippet',
  'mermaid',
  'dbml',
  'onboarding-md',
  'concept-pack',
  'plan-md',
  'speckit',
  'kiro',
  'likec4',
  'structurizr',
  'plantuml',
  'sequence',
  'openapi',
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Options common to all exporters (Implementation.md §18). */
export interface ExportOptions {
  /** Export only this element's neighborhood. */
  focus?: Id;
  /** Neighborhood size: relations followed from the focus (default 1). */
  depth?: number;
  /** Notes, comments and element notes (default true). */
  includeNotes?: boolean;
  /** `## Concepts` section in agent-md (default false). */
  includeConcepts?: boolean;
  /** Reader level for onboarding texts (default intermediate). */
  level?: Level;
  /** concept-pack: the concept, pattern or template to pack. */
  conceptId?: string;
  /** Where the project file lives, for pointers in agents-snippet. */
  projectPath?: string;
  /**
   * Change set: the plan formats (plan-md, speckit, kiro) need one; other formats export
   * baseline + change set.
   */
  changeSetId?: Id;
  /** sequence: the scenario view to export. */
  viewId?: Id;
}

export interface ExportFile {
  path: string;
  content: string;
  mime: string;
}

export interface ExportResult {
  files: ExportFile[];
}

export interface ExportContext {
  catalog: Catalog;
}
