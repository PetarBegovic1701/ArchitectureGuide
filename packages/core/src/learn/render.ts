import type { Catalog } from '../catalog';
import { allRules } from '../rules';
import type { LearningDoc, Level } from './schema';

/**
 * A learning text as Markdown at one level (Implementation.md §17.2), for terminals and
 * agents: the text for the level, the analogy for beginners, the lists, examples and
 * references, the quiz without answers, and the related IDs.
 */
export function renderDocMarkdown(doc: LearningDoc, level: Level): string {
  const e = doc.explain;
  const text =
    level === 'beginner'
      ? e.beginner
      : level === 'senior'
        ? e.senior
        : (e.intermediate ?? e.beginner);
  const out = [`# ${doc.title}`, '', `_${doc.summary}_`, '', text.trim()];
  const list = (title: string, items?: string[]) => {
    if (items?.length) out.push('', `## ${title}`, '', ...items.map((i) => `- ${i}`));
  };
  if (level === 'beginner' && doc.analogy) out.push('', '## Analogy', '', doc.analogy.trim());
  list('When to use', doc.whenToUse);
  if (level !== 'beginner') {
    list('When not to use', doc.whenNotToUse);
    list('Trade-offs', doc.tradeoffs);
  }
  list('Common mistakes', doc.mistakes);
  const examples = level === 'beginner' ? (doc.examples ?? []).slice(0, 1) : (doc.examples ?? []);
  if (examples.length) {
    out.push('', '## Examples');
    for (const ex of examples)
      out.push(
        '',
        ...(ex.title ? [`**${ex.title}**`, ''] : []),
        '```' + ex.language,
        ex.code.trimEnd(),
        '```',
      );
  }
  if (doc.quiz?.length) {
    out.push('', '## Check yourself');
    doc.quiz.forEach((q, i) =>
      out.push(
        '',
        `${i + 1}. ${q.question}`,
        ...q.options.map((o, j) => `   ${String.fromCharCode(97 + j)}) ${o}`),
      ),
    );
  }
  if (doc.related.length) out.push('', `Related: ${doc.related.join(', ')}`);
  if (level !== 'beginner' && doc.references.length)
    out.push('', '## References', '', ...doc.references.map((r) => `- [${r.title}](${r.url})`));
  return `${out.join('\n')}\n`;
}

/** The learning texts of all profiles in a catalog. */
export function catalogDocs(catalog: Catalog): LearningDoc[] {
  return catalog.profiles.flatMap((p) => [...(p.content?.docs ?? [])]);
}

/** The lessons of all profiles in a catalog. */
export function catalogLessons(catalog: Catalog) {
  return catalog.profiles.flatMap((p) => [...(p.content?.lessons ?? [])]);
}

/**
 * What `explain_concept` and `archguide explain` print for an ID: the learning text of a
 * concept, relation type, topic or pattern at a level (or a rule's rationale with its text),
 * plus the concept guide's real-world uses and typical connections.
 */
export function explainText(catalog: Catalog, id: string, level: Level): string | undefined {
  const doc = catalogDocs(catalog).find((d) => d.id === id);
  const concept = catalog.concepts.get(id);
  const relationType = catalog.relationTypes.get(id);
  const guide = catalog.guides.get(id);
  const parts: string[] = [];
  if (doc) parts.push(renderDocMarkdown(doc, level).trimEnd());
  else if (concept || relationType)
    parts.push(
      `# ${concept?.name ?? relationType?.name}`,
      '',
      concept?.docs ?? relationType?.docs ?? '',
    );
  else {
    const rule = allRules(catalog).find((r) => r.id === id);
    if (!rule) return undefined;
    const learn = rule.learnId
      ? catalogDocs(catalog).find((d) => d.id === rule.learnId)
      : undefined;
    parts.push(
      `# ${rule.id} ${rule.title}`,
      '',
      `Severity: ${rule.severity}`,
      '',
      rule.rationale.trim(),
    );
    if (learn) parts.push('', renderDocMarkdown(learn, level).trimEnd());
  }
  if (guide) {
    parts.push('', '## In real projects', '', ...guide.examples.map((e) => `- ${e}`));
    if (guide.connections.length)
      parts.push(
        '',
        '## Typical connections',
        '',
        ...guide.connections.map((l) =>
          l.direction === 'out'
            ? `- ${id} —${l.type}→ ${l.kind}: ${l.note}`
            : `- ${l.kind} —${l.type}→ ${id}: ${l.note}`,
        ),
      );
  }
  return `${parts.join('\n')}\n`;
}
