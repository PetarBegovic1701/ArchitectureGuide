import { serializeProject } from '../serialize';
import type { Catalog } from '../catalog';
import type { Project } from '../schema';
import { computeFacts } from './facts';
import { agentYaml, dbml, mermaid } from './formats';
import { agentMarkdown, agentsSnippet } from './markdown';
import { conceptPack, onboardingMarkdown } from './onboarding';
import type { ExportFormat, ExportOptions, ExportResult } from './types';

export * from './types';
export {
  computeFacts,
  conceptsUsed,
  glossary,
  invariants,
  knownIssues,
  neighborhood,
  ownership,
} from './facts';
export type { Facts, Invariant, KnownIssue, OwnershipRow, UsedConcept } from './facts';

const MARKDOWN = 'text/markdown';

/**
 * Exports a project (Implementation.md §18). Pure and deterministic: the same project
 * gives the same files, so outputs can be committed and diffed.
 */
export function exportProject(
  format: ExportFormat,
  project: Project,
  catalog: Catalog,
  options: ExportOptions = {},
): ExportResult {
  const facts = () => computeFacts(project, catalog, options);
  const suffix = options.focus ? `.${options.focus}` : '';
  switch (format) {
    case 'json':
      return {
        files: [
          {
            path: `${project.id}.archguide.json`,
            content: serializeProject(project),
            mime: 'application/json',
          },
        ],
      };
    case 'agent-md':
      return {
        files: [
          {
            path: `ARCHITECTURE${suffix}.md`,
            content: agentMarkdown(facts(), options),
            mime: MARKDOWN,
          },
        ],
      };
    case 'agent-yaml':
      return {
        files: [
          {
            path: `architecture${suffix}.yaml`,
            content: agentYaml(facts()),
            mime: 'application/yaml',
          },
        ],
      };
    case 'agents-snippet':
      return {
        files: [
          { path: 'AGENTS.snippet.md', content: agentsSnippet(facts(), options), mime: MARKDOWN },
        ],
      };
    case 'mermaid':
      return {
        files: [
          { path: `${project.id}${suffix}.mmd`, content: mermaid(facts()), mime: 'text/plain' },
        ],
      };
    case 'dbml':
      return {
        files: [{ path: `${project.id}.dbml`, content: dbml(facts()), mime: 'text/plain' }],
      };
    case 'onboarding-md':
      return {
        files: [
          { path: 'ONBOARDING.md', content: onboardingMarkdown(facts(), options), mime: MARKDOWN },
        ],
      };
    case 'concept-pack':
      return conceptPack(project, catalog, options);
  }
}
