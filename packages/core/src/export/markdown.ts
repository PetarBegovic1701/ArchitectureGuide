import type { Element, Relation } from '../schema';
import { conceptsUsed, glossary, invariants, knownIssues, ownership, patterns } from './facts';
import type { Facts } from './facts';
import type { ExportOptions } from './types';

// --- Markdown helpers --------------------------------------------------------------

/** A table cell: one line, pipes escaped, "–" when empty. */
export function cell(value: string | undefined | null): string {
  const text = (value ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
  return text || '–';
}

export function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

const section = (title: string, body: string) =>
  body.trim() ? `## ${title}\n\n${body.trim()}` : '';

// --- shared row builders ---------------------------------------------------------------

export function relationDetails(r: Relation): string {
  const parts: string[] = [];
  if (r.protocol) parts.push(r.protocol);
  if (r.label) parts.push(r.label);
  if (r.via) parts.push(`via ${r.via}`);
  if (r.mode === 'async') parts.push('async');
  if (r.inTransaction) parts.push('in the same transaction');
  for (const [k, v] of Object.entries(r.properties ?? {}))
    parts.push(`${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  return parts.join(', ');
}

function elementRow(f: Facts, e: Element): string[] {
  return [
    e.id,
    e.kind,
    e.name,
    e.parentId ?? '',
    f.graph.layerOf(e.id) ?? '',
    e.tech ?? '',
    (e.responsibilities ?? []).join('; '),
    (e.codePaths ?? []).join(', '),
  ];
}

function frontMatter(f: Facts): string {
  const p = f.project;
  const lines = [
    '---',
    'archguide: 1',
    `project: ${p.id}`,
    `profile: ${p.profile}`,
    ...(patterns(p).length ? [`patterns: [${patterns(p).join(', ')}]`] : []),
    `revision: ${p.revision}`,
    `generated: ${p.updatedAt.slice(0, 10)}`,
    '---',
  ];
  return lines.join('\n');
}

export function elementsTable(f: Facts): string {
  return table(
    ['ID', 'Kind', 'Name', 'Parent', 'Layer', 'Tech', 'Responsibilities', 'Code'],
    f.elements.map((e) => elementRow(f, e)),
  );
}

export function relationsTable(f: Facts): string {
  return table(
    ['From', 'Relation', 'To', 'Details'],
    f.relations.map((r) => [r.sourceId, r.type, r.targetId, relationDetails(r)]),
  );
}

export function ownershipTable(f: Facts): string {
  const rows = ownership(f);
  if (rows.length === 0) return '';
  return table(
    ['Store', 'Owner (migrations)', 'Writers', 'Readers'],
    rows.map((r) => [
      r.storeId,
      [...r.owners, ...(r.ownedBy ? [`module ${r.ownedBy}`] : [])].join(', '),
      r.writers.join(', '),
      r.readers.join(', '),
    ]),
  );
}

export function invariantsList(f: Facts): string {
  return invariants(f)
    .map((i) => `- ${i.text} (${i.source})`)
    .join('\n');
}

function knownIssuesTable(f: Facts): string {
  const issues = knownIssues(f);
  if (issues.length === 0) return '';
  return table(
    ['Rule', 'Where', 'Status', 'Reason'],
    issues.map((i) => [`${i.ruleId} ${i.title}`, i.targetIds.join(', '), i.status, i.reason]),
  );
}

function decisionsList(f: Facts): string {
  return f.project.decisions
    .filter((d) => d.status === 'accepted' || d.status === 'proposed')
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(
      (d) =>
        `- **${d.id}** (${d.status}): ${d.title}. ${d.decision.trim()}${d.linkedIds.length ? ` Links: ${d.linkedIds.join(', ')}.` : ''}`,
    )
    .join('\n');
}

function glossaryList(f: Facts): string {
  return glossary(f.project)
    .map((g) => `- **${g.term}**: ${g.definition}`)
    .join('\n');
}

function conceptsList(f: Facts): string {
  return conceptsUsed(f)
    .map((c) => `- **${c.name}** (\`${c.id}\`): ${c.summary}`)
    .join('\n');
}

function notesSection(f: Facts): string {
  const parts: string[] = [];
  for (const n of [...f.project.notes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (n.title.trim().toLowerCase() === 'glossary') continue;
    parts.push(`### ${n.title}\n\n${n.body.trim()}`);
  }
  const itemNotes = [...f.elements, ...f.relations]
    .filter((x) => x.notes?.trim())
    .map((x) => `- \`${x.id}\`: ${x.notes!.trim().replace(/\n+/g, ' ')}`);
  if (itemNotes.length) parts.push(`### On elements and relations\n\n${itemNotes.join('\n')}`);
  const comments = f.project.views
    .flatMap((v) => v.annotations)
    .filter((a) => a.kind === 'comment' && !a.resolved)
    .map((a) => {
      const on =
        'elementId' in a.anchor
          ? a.anchor.elementId
          : 'relationId' in a.anchor
            ? a.anchor.relationId
            : '';
      const replies = (a.replies ?? []).map((r) => ` / ${r.text}`).join('');
      return `- ${on ? `On \`${on}\`: ` : ''}${a.text.replace(/\n+/g, ' ')}${replies}`;
    });
  if (comments.length) parts.push(`### Open comments\n\n${comments.join('\n')}`);
  const name = (id: string) => f.graph.element(id)?.name ?? id;
  const canvasNotes = f.project.views
    .flatMap((v) => v.annotations)
    .filter((a) => a.kind !== 'comment' && a.text.trim())
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => {
      const text = a.text.trim().replace(/\n+/g, ' ');
      if (a.kind === 'region') return `- Region “${text}”`;
      if ('elementId' in a.anchor)
        return `- On \`${a.anchor.elementId}\` (${name(a.anchor.elementId)}): ${text}`;
      if ('relationId' in a.anchor) return `- On \`${a.anchor.relationId}\`: ${text}`;
      return `- ${text}`;
    });
  if (canvasNotes.length) parts.push(`### On the canvas\n\n${canvasNotes.join('\n')}`);
  return parts.join('\n\n');
}

function changeSetsList(f: Facts): string {
  return f.project.changeSets
    .filter((c) => c.status === 'draft' || c.status === 'ready')
    .map((c) => `- **${c.name}** (${c.status}): plans/${c.id}.md`)
    .join('\n');
}

/** `ARCHITECTURE.md`: the primary format for AI agents and reviewers (§18.2). */
export function agentMarkdown(f: Facts, options: ExportOptions): string {
  const p = f.project;
  const focus = options.focus ? f.graph.element(options.focus) : undefined;
  const intro = [
    p.description?.trim(),
    focus
      ? `This file covers the neighborhood of \`${focus.id}\` (${focus.name}), ${options.depth ?? 1} relation(s) deep.`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  const notes = options.includeNotes === false ? '' : notesSection(f);
  // Blocks separated by one blank line; empty sections are left out.
  const blocks = [
    frontMatter(f),
    `# Architecture: ${p.name}`,
    intro,
    section('Elements', elementsTable(f)),
    section('Relations', f.relations.length ? relationsTable(f) : ''),
    section('Data ownership', ownershipTable(f)),
    section('Invariants', invariantsList(f)),
    section('Known issues', knownIssuesTable(f)),
    section('Decisions', decisionsList(f)),
    section('Glossary', glossaryList(f)),
    section('Concepts', options.includeConcepts ? conceptsList(f) : ''),
    section('Notes', notes),
    section('Open change sets', changeSetsList(f)),
  ];
  return `${blocks.filter((x) => x.trim()).join('\n\n')}\n`;
}

/** A short block for `AGENTS.md` / `CLAUDE.md` (§18.5). */
export function agentsSnippet(f: Facts, options: ExportOptions): string {
  const file = options.projectPath ?? `architecture/${f.project.id}.archguide.json`;
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  // Project-specific rules only; the general rules are in ARCHITECTURE.md.
  const rules = invariants(f).filter((i) => !/^[A-Z]+-\d{3}$/.test(i.source));
  return [
    '## Architecture',
    '',
    `The architecture model is in \`${file}\`; read \`${dir}ARCHITECTURE.md\` before you plan changes.`,
    ...(rules.length ? ['Rules:', ...rules.map((i) => `- ${i.text}`)] : []),
    `More rules: the Invariants section of \`${dir}ARCHITECTURE.md\`.`,
    'After a structural change, update the model (MCP tools `upsert_elements` / `upsert_relations`) or run `archguide analyze --write`.',
    '',
  ].join('\n');
}
