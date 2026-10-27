import type { Level, LearningDoc } from '@archguide/core';
import { docs } from './catalog';

export const LEVELS: Level[] = ['beginner', 'intermediate', 'senior'];

/** The learning text for a concept, relation type, rule or topic ID. */
export function docFor(id: string): LearningDoc | undefined {
  return docs.get(id);
}

/** Texts that list `id` as related, so a concept without its own text still links somewhere. */
export function relatedDocs(id: string): LearningDoc[] {
  return [...docs.values()].filter((d) => d.id !== id && d.related.includes(id));
}

export interface LevelView {
  text: string;
  analogy?: string;
  lists: { title: string; items: string[] }[];
  examples: NonNullable<LearningDoc['examples']>;
  references: LearningDoc['references'];
}

/**
 * What a reader at `level` sees (Implementation.md §17.2). Beginners get plain text, an
 * analogy and one example; seniors get the deep text, trade-offs and references.
 */
export function textAt(doc: LearningDoc, level: Level): LevelView {
  const e = doc.explain;
  const text =
    level === 'beginner'
      ? e.beginner
      : level === 'senior'
        ? e.senior
        : (e.intermediate ?? e.beginner);
  const lists: LevelView['lists'] = [];
  const add = (title: string, items?: string[]) => items?.length && lists.push({ title, items });
  if (level === 'beginner') {
    add('When to use', doc.whenToUse);
    add('Common mistakes', doc.mistakes);
  } else {
    add('When to use', doc.whenToUse);
    add('When not to use', doc.whenNotToUse);
    add('Trade-offs', doc.tradeoffs);
    add('Common mistakes', doc.mistakes);
  }
  const examples = doc.examples ?? [];
  return {
    text,
    ...(level === 'beginner' && doc.analogy ? { analogy: doc.analogy } : {}),
    lists,
    examples: level === 'beginner' ? examples.slice(0, 1) : examples,
    references: level === 'beginner' ? [] : doc.references,
  };
}
