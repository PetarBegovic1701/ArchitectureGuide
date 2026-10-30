import { applyOps } from '../ops';
import { createProject } from '../project';
import type { Catalog } from '../catalog';
import type { LearningDoc, Level } from '../learn/schema';
import type { Project, Tour } from '../schema';
import { allTemplates, instantiateTemplate, renderInvariants, resolveParams } from '../templates';
import type { Template } from '../templates';
import { draftTour } from '../tours/draft';
import { computeFacts, conceptsUsed, docsById, glossary, invariants } from './facts';
import type { Facts } from './facts';
import { mermaid } from './formats';
import { antiPatternsList, documentationSection, ownershipTable } from './markdown';
import type { ExportOptions, ExportResult } from './types';

/** The text of a learning doc at a level (intermediate falls back to beginner). */
export function textAtLevel(doc: LearningDoc, level: Level): string {
  if (level === 'senior') return doc.explain.senior;
  if (level === 'intermediate') return doc.explain.intermediate ?? doc.explain.beginner;
  return doc.explain.beginner;
}

const firstParagraph = (text: string) =>
  text
    .trim()
    .split(/\n\s*\n/)[0]!
    .trim();

function tourText(f: Facts, tour: Tour): string {
  const name = (id: string) => f.graph.element(id)?.name ?? f.graph.relation(id)?.type ?? id;
  return tour.steps
    .map((s, i) => {
      const items = s.elementIds.length
        ? `\n\n   Look at: ${s.elementIds.map(name).join(', ')}.`
        : '';
      return `${i + 1}. **${s.title}**: ${s.body.trim().replace(/\n+/g, ' ')}${items}`;
    })
    .join('\n');
}

/**
 * `ONBOARDING.md` for people joining the project (Implementation.md §17.8): the big
 * picture, what the parts are and do (the repository's documentation), the tour as text,
 * data ownership, rules of the road, anti-patterns found in the code, decisions, glossary,
 * the concepts this project uses explained at the reader's level, and where to start.
 */
export function onboardingMarkdown(f: Facts, options: ExportOptions): string {
  const p = f.project;
  const level = options.level ?? 'intermediate';
  const docs = docsById(f.catalog);
  const tour = p.tours.find((t) => t.audience !== 'agent') ?? draftTour(p, f.catalog);
  const rules = invariants(f).filter((i) => !/^[A-Z]+-\d{3}$/.test(i.source));
  const decisions = p.decisions.filter((d) => d.status === 'accepted');
  const terms = glossary(p);
  const concepts = conceptsUsed(f).map((c) => {
    const doc = docs.get(c.id);
    const text = doc
      ? `\n\n  ${firstParagraph(textAtLevel(doc, level)).replace(/\n/g, '\n  ')}`
      : '';
    return `- **${c.name}** (\`${c.id}\`): ${c.summary}${text}`;
  });
  const templates = allTemplates(f.catalog);
  const patternDocs = [...new Set((p.derivedFrom ?? []).map((d) => d.templateId))]
    .map((id) => templates.find((t) => t.id === id)?.learnId)
    .flatMap((id) => (id && docs.get(id) ? [docs.get(id)!] : []));
  const starters = f.elements.filter((e) => e.tags?.includes('good-first-task'));
  const openChanges = p.changeSets.filter((c) => c.status === 'draft' || c.status === 'ready');

  const parts = [
    `# Onboarding: ${p.name}`,
    p.description?.trim() ?? '',
    `This guide is written for the **${level}** level. Open the project in ArchitectureGuide to see the diagram, follow the tour, and read every concept at your level.`,
    '## The big picture',
    `\`\`\`mermaid\n${mermaid(f).trim()}\n\`\`\``,
    `## ${tour.title.replace(/^Tour: /, 'Tour of ')}`,
    tourText(f, tour),
  ];
  // What each part is and does, in the words (and language) of the repository's documentation.
  const documentation = documentationSection(f);
  if (documentation) parts.push('## What the parts are and do', documentation);
  if (patternDocs.length)
    parts.push(
      '## Patterns used',
      patternDocs
        .map((d) => `### ${d.title}\n\n${d.summary}\n\n${textAtLevel(d, level).trim()}`)
        .join('\n\n'),
    );
  const ownership = ownershipTable(f);
  if (ownership) parts.push('## Who owns which data', ownership);
  if (rules.length) parts.push('## Rules of the road', rules.map((r) => `- ${r.text}`).join('\n'));
  const antiPatterns = antiPatternsList(f);
  if (antiPatterns)
    parts.push(
      '## Anti-patterns found in the code',
      `The code does these things against the design. They are in the diagram as found, so it matches the code; do not copy them, and fix them when you work nearby.\n\n${antiPatterns}`,
    );
  if (decisions.length)
    parts.push(
      '## Decisions',
      decisions.map((d) => `- **${d.title}**: ${d.decision.trim()}`).join('\n'),
    );
  if (terms.length)
    parts.push('## Glossary', terms.map((t) => `- **${t.term}**: ${t.definition}`).join('\n'));
  if (concepts.length) parts.push('## Concepts used in this project', concepts.join('\n'));
  if (starters.length || openChanges.length)
    parts.push(
      '## Where to start',
      [
        ...starters.map((e) => `- \`${e.id}\` ${e.name}: tagged as a good first task.`),
        ...openChanges.map((c) => `- Planned change **${c.name}** (${c.status}).`),
      ].join('\n'),
    );
  return `${parts.filter((x) => x.trim()).join('\n\n')}\n`;
}

/** The template a concept pack is about: by template ID, or by its learning text. */
function templateFor(catalog: Catalog, id: string): Template | undefined {
  return allTemplates(catalog).find((t) => t.id === id || t.learnId === id);
}

/**
 * `concepts/<id>.md`: one concept or pattern, packed so a person or an agent can apply
 * it to their own repository: the learning text at all levels, the template with its
 * invariants and folder layout, a diagram of the template, and its tour (§17.8).
 */
export function conceptPack(
  project: Project,
  catalog: Catalog,
  options: ExportOptions,
): ExportResult {
  const id = options.conceptId ?? project.derivedFrom?.[0]?.templateId;
  if (!id) throw new Error('Choose a concept, pattern or template for the concept pack.');
  const template = templateFor(catalog, id);
  const docs = docsById(catalog);
  const doc = docs.get(id) ?? (template?.learnId ? docs.get(template.learnId) : undefined);
  const concept = catalog.concepts.get(id);
  if (!doc && !template && !concept)
    throw new Error(`Unknown concept, pattern or template "${id}".`);

  const title = doc?.title ?? template?.name ?? concept!.name;
  const parts: string[] = [`# ${title}`];
  if (doc) {
    parts.push(`> ${doc.summary}`);
    parts.push('## For beginners', doc.explain.beginner.trim());
    if (doc.explain.intermediate) parts.push('## Going further', doc.explain.intermediate.trim());
    parts.push('## In depth', doc.explain.senior.trim());
    if (doc.mistakes?.length)
      parts.push('## Common mistakes', doc.mistakes.map((m) => `- ${m}`).join('\n'));
    for (const ex of doc.examples ?? [])
      parts.push(
        `${ex.title ? `**${ex.title}**\n\n` : ''}\`\`\`${ex.language}\n${ex.code.trim()}\n\`\`\``,
      );
  } else if (concept) {
    parts.push(concept.docs);
  }
  if (template) {
    const { values } = resolveParams(template);
    parts.push(`## Template ${template.code}: ${template.name}`, template.summary);
    parts.push('**When to use**', template.whenToUse.map((x) => `- ${x}`).join('\n'));
    parts.push('**When not to use**', template.whenNotToUse.map((x) => `- ${x}`).join('\n'));
    parts.push('**Trade-offs**', template.tradeoffs.map((x) => `- ${x}`).join('\n'));
    parts.push(
      '## Invariants',
      renderInvariants(template, values)
        .map((x) => `- ${x}`)
        .join('\n'),
    );
    if (template.folderLayout)
      parts.push(
        '## Folder layout',
        Object.entries(template.folderLayout)
          .map(
            ([kind, path]) =>
              `- \`${kind}\`: \`${path.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? k))}\``,
          )
          .join('\n'),
      );
    const example = exampleProject(template, catalog, project.profile);
    const f = computeFacts(example, catalog);
    parts.push(
      `## Example (default settings: ${Object.entries(values)
        .map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('; ')})`,
      `\`\`\`mermaid\n${mermaid(f).trim()}\n\`\`\``,
    );
    const tour = example.tours[0];
    if (tour) parts.push('## Walkthrough', tourText(f, tour));
  }
  if (doc?.references.length)
    parts.push('## Sources', doc.references.map((r) => `- [${r.title}](${r.url})`).join('\n'));
  return {
    files: [
      { path: `concepts/${id}.md`, content: `${parts.join('\n\n')}\n`, mime: 'text/markdown' },
    ],
  };
}

function exampleProject(template: Template, catalog: Catalog, profile: string): Project {
  const base = createProject({
    id: 'example',
    name: template.name,
    profile,
    now: '2026-01-01T00:00:00.000Z',
  });
  const result = applyOps(base, instantiateTemplate(template, base, catalog).ops, catalog);
  if (!result.ok) throw new Error(`Template ${template.id} could not be built.`);
  return result.project;
}
