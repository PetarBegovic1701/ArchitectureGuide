import { serializeProject } from '../serialize';
import type { Catalog } from '../catalog';
import type { Project } from '../schema';
import { computeFacts } from './facts';
import { agentYaml, dbml, mermaid } from './formats';
import { agentMarkdown, agentsSnippet } from './markdown';
import { conceptPack, onboardingMarkdown } from './onboarding';
import { kiro, planMarkdown, planOf, specKit } from './plan';
import { likec4, plantuml, structurizr } from './interop';
import { openapi, sequenceDiagram } from './api';
import { effectiveProject } from '../changesets';
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
export { ears, planOf } from './plan';
export type { Plan } from './plan';
export { endpointsOf, isEndpoint, openapi, sequenceDiagram } from './api';
export type { EndpointRow } from './api';
export { likec4, plantuml, structurizr } from './interop';

const PLAN_FORMATS: readonly ExportFormat[] = ['plan-md', 'speckit', 'kiro'];

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
  if (options.changeSetId && !PLAN_FORMATS.includes(format)) {
    const cs = project.changeSets.find((c) => c.id === options.changeSetId);
    if (!cs) throw new Error(`Unknown change set "${options.changeSetId}".`);
    const { changeSetId: _cs, ...rest } = options;
    return exportProject(format, effectiveProject(project, cs, catalog).effective, catalog, rest);
  }
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
    case 'plan-md':
    case 'speckit':
    case 'kiro':
      return planExport(format, project, catalog, options);
    case 'likec4':
      return {
        files: [
          { path: `${project.id}${suffix}.c4`, content: likec4(facts()), mime: 'text/plain' },
        ],
      };
    case 'structurizr':
      return {
        files: [
          { path: `${project.id}${suffix}.dsl`, content: structurizr(facts()), mime: 'text/plain' },
        ],
      };
    case 'plantuml':
      return {
        files: [
          {
            path: `${project.id}${suffix}.puml`,
            content: plantuml(facts(), options.focus),
            mime: 'text/plain',
          },
        ],
      };
    case 'sequence': {
      const view =
        project.views.find((v) => v.id === options.viewId) ??
        (options.viewId ? undefined : project.views.find((v) => v.scenario?.steps.length));
      if (!view?.scenario)
        throw new Error('sequence exports a scenario view: choose one (viewId).');
      return {
        files: [
          {
            path: `${view.id}.sequence.mmd`,
            content: sequenceDiagram(computeFacts(project, catalog), view),
            mime: 'text/plain',
          },
        ],
      };
    }
    case 'openapi':
      return {
        files: [
          {
            path: `${options.focus ?? project.id}.openapi.yaml`,
            content: openapi(facts(), options.focus),
            mime: 'application/yaml',
          },
        ],
      };
  }
}

function planExport(
  format: 'plan-md' | 'speckit' | 'kiro',
  project: Project,
  catalog: Catalog,
  options: ExportOptions,
): ExportResult {
  if (!options.changeSetId)
    throw new Error(`${format} exports a change set: choose one (changeSetId).`);
  const plan = planOf(project, catalog, options.changeSetId);
  if (format === 'plan-md')
    return {
      files: [
        {
          path: `plans/${plan.changeSet.id}.md`,
          content: planMarkdown(project, plan),
          mime: MARKDOWN,
        },
      ],
    };
  return { files: (format === 'speckit' ? specKit : kiro)(project, plan, catalog) };
}
