import type { Catalog } from '../catalog';
import type { Rule } from '../rules/types';
import type { Check, LearningDoc, Lesson, Track } from './schema';

/** Track names and one-line descriptions for the Library and Tracks pages (§17.3). */
export const TRACKS: { id: Track; name: string; description: string }[] = [
  {
    id: 'foundations',
    name: 'Foundations',
    description: 'Client and server, the request lifecycle, the three parts of a web app.',
  },
  {
    id: 'data-and-models',
    name: 'Data and models',
    description: 'Domain, persistence and data shapes; tables, keys, migrations, functions, views.',
  },
  {
    id: 'api-design',
    name: 'API design',
    description: 'Endpoints, status codes, validation, errors, pagination, idempotency, contracts.',
  },
  {
    id: 'state-management',
    name: 'State management',
    description: 'Client vs server state, caching and invalidation, actions, effects, stores.',
  },
  {
    id: 'auth',
    name: 'Authentication and authorization',
    description: 'Sessions and tokens, cookies and CSRF, OpenID Connect, roles, ownership checks.',
  },
  {
    id: 'concurrency-and-parallelism',
    name: 'Concurrency and parallelism',
    description: 'The event loop, workers, pools, transactions, lost updates, locks, job queues.',
  },
  {
    id: 'patterns',
    name: 'Architecture patterns',
    description: 'Layered, hexagonal, modular monolith, BFF, database per service and more.',
  },
  {
    id: 'operations',
    name: 'Operations',
    description: 'Caching, rate limiting, observability, background jobs at scale.',
  },
];

/** Texts of a track, beginner texts first, then by title. */
export function docsInTrack(docs: readonly LearningDoc[], track: Track): LearningDoc[] {
  const order = { beginner: 0, intermediate: 1, senior: 2 } as const;
  return docs
    .filter((d) => d.tracks.includes(track))
    .sort((a, b) => order[a.level] - order[b.level] || a.title.localeCompare(b.title));
}

/**
 * Texts that match every word of `query`, best first: a match in the title or ID counts
 * more than one in the tags or summary, and those count more than one in the body.
 */
export function searchDocs(docs: readonly LearningDoc[], query: string): LearningDoc[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...docs];
  const scored: { doc: LearningDoc; score: number }[] = [];
  for (const doc of docs) {
    const head = `${doc.title} ${doc.id}`.toLowerCase();
    const meta = `${doc.summary} ${(doc.tags ?? []).join(' ')}`.toLowerCase();
    const body = [
      doc.explain.beginner,
      doc.explain.intermediate ?? '',
      doc.explain.senior,
      ...(doc.mistakes ?? []),
    ]
      .join(' ')
      .toLowerCase();
    let score = 0;
    for (const word of words) {
      const s = head.includes(word) ? 10 : meta.includes(word) ? 4 : body.includes(word) ? 1 : 0;
      if (s === 0) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score > 0) scored.push({ doc, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
    .map((s) => s.doc);
}

export interface Coverage {
  concepts: { covered: number; total: number; missing: string[] };
  relationTypes: { covered: number; total: number; missing: string[] };
  rules: { covered: number; total: number; missing: string[] };
}

/** Which concepts, relation types and rules have a learning text (§17.6). */
export function contentCoverage(
  catalog: Catalog,
  docs: readonly LearningDoc[],
  rules: readonly Rule[] = [],
): Coverage {
  const ids = new Set(docs.map((d) => d.id));
  const part = (all: string[]) => {
    const missing = all.filter((id) => !ids.has(id));
    return { covered: all.length - missing.length, total: all.length, missing };
  };
  return {
    concepts: part([...catalog.concepts.keys()]),
    relationTypes: part([...catalog.relationTypes.keys()]),
    rules: part(rules.map((r) => r.id)),
  };
}

function usesFindingCheck(check: Check | undefined): boolean {
  if (!check) return false;
  if ('finding' in check) return true;
  if ('all' in check) return check.all.some(usesFindingCheck);
  if ('any' in check) return check.any.some(usesFindingCheck);
  if ('not' in check) return usesFindingCheck(check.not);
  return false;
}

/**
 * An exercise starts from a flawed model and is graded by the rules engine (§17.5): it has
 * start ops and at least one step with a `finding` check.
 */
export function isExercise(lesson: Lesson): boolean {
  return lesson.start.ops.length > 0 && lesson.steps.some((s) => usesFindingCheck(s.check));
}
