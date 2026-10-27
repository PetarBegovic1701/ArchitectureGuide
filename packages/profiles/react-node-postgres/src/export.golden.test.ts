import { describe, expect, it } from 'vitest';
import {
  applyOps,
  createCatalog,
  createProject,
  exportProject,
  instantiateTemplate,
} from '@archguide/core';
import type { ExportFormat, Project, Template } from '@archguide/core';
import { PROFILE_ID, TEMPLATES, profile } from '.';

/**
 * Golden files (Implementation.md §25): the output of every exporter for every template,
 * committed under golden/<template code>/. A change in output shows up as a diff to
 * review. Update them with `pnpm test -u` after checking the change is intended.
 */

const catalog = createCatalog([profile]);
const FORMATS: ExportFormat[] = [
  'agent-md',
  'agent-yaml',
  'agents-snippet',
  'mermaid',
  'dbml',
  'onboarding-md',
];

function fromTemplate(t: Template): Project {
  const base = createProject({
    id: t.id.replace(/^rnp\./, ''),
    name: t.name,
    description: t.summary,
    profile: PROFILE_ID,
    now: '2026-10-27T00:00:00.000Z',
  });
  const result = applyOps(base, instantiateTemplate(t, base, catalog).ops, catalog);
  if (!result.ok) throw new Error(`${t.id}: ${JSON.stringify(result.errors[0])}`);
  return result.project;
}

describe.each(TEMPLATES.map((t) => [t.code, t] as const))('%s exports', (code, template) => {
  const project = fromTemplate(template);

  it.each(FORMATS)('%s', async (format) => {
    const { files } = exportProject(format, project, catalog, {
      includeConcepts: format === 'agent-md',
    });
    for (const file of files)
      await expect(file.content).toMatchFileSnapshot(`../golden/${code}/${file.path}`);
  });

  it('concept-pack', async () => {
    const { files } = exportProject('concept-pack', project, catalog, { conceptId: template.id });
    for (const file of files)
      await expect(file.content).toMatchFileSnapshot(`../golden/${code}/${file.path}`);
  });

  it('is deterministic', () => {
    const again = fromTemplate(template);
    for (const format of FORMATS)
      expect(exportProject(format, again, catalog).files).toEqual(
        exportProject(format, project, catalog).files,
      );
  });
});
