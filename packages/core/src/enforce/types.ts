import type { Catalog } from '../catalog';
import type { Project } from '../schema';

export const ENFORCEMENT_TARGETS = ['dependency-cruiser', 'nx', 'archunit'] as const;
export type EnforcementTarget = (typeof ENFORCEMENT_TARGETS)[number];

export interface GeneratorContext {
  catalog: Catalog;
  /** The project file, relative to the repository root, for the "generated from" header. */
  projectPath: string;
}

export interface GeneratedConfig {
  /** Suggested path, relative to the repository root. */
  path: string;
  content: string;
  /** Rule names, for reports and tests. */
  rules: string[];
}

/** Turns the model into a config that a standard tool enforces in CI (Implementation.md §23.1). */
export interface EnforcementGenerator {
  id: EnforcementTarget;
  name: string;
  generate(project: Project, ctx: GeneratorContext): GeneratedConfig;
}
