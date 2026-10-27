import { allRules, runRules } from '@archguide/core';
import type {
  Element,
  Finding,
  Id,
  Level,
  Op,
  Project,
  QuickFix,
  Rule,
  Severity,
  View,
} from '@archguide/core';
import { catalog, defaultSize } from './catalog';
import {
  CONTAINER_HEADER,
  CONTAINER_PADDING,
  elementById,
  freeSpot,
  nodeSize,
  snap,
} from './model';
import type { Point } from './model';

/**
 * Rules run on the main thread, once per project change (Implementation.md §11.3: under
 * 100 ms for 500 elements). A Web Worker is the next step if real models get slower.
 */
let cache: { project: Project; findings: Finding[] } | undefined;

export function findingsOf(p: Project): Finding[] {
  if (cache?.project !== p) cache = { project: p, findings: runRules(p, catalog) };
  return cache.findings;
}

export const RULES: ReadonlyMap<string, Rule> = new Map(allRules(catalog).map((r) => [r.id, r]));

/** Stable key of a finding: the same as its suppression key. */
export function findingKey(f: Pick<Finding, 'ruleId' | 'targetIds'>): string {
  return `${f.ruleId}|${f.targetIds.join(',')}`;
}

export const SEVERITIES: Severity[] = ['error', 'warning', 'info'];
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export const SEVERITY_COLOR: Record<Severity, string> = {
  error: 'var(--ag-error)',
  warning: 'var(--ag-warning)',
  info: 'var(--ag-info)',
};

/** What a severity is called at a level: beginners see info findings as tips. */
export function severityLabel(severity: Severity, level: Level, plural = true): string {
  if (severity === 'info') return level === 'beginner' ? (plural ? 'Tips' : 'Tip') : 'Info';
  const word = severity === 'error' ? 'Error' : 'Warning';
  return plural ? `${word}s` : word;
}

/** Whether info findings get a badge on the canvas. Seniors only see them in the panel. */
export const showsInfoBadges = (level: Level) => level !== 'senior';

export interface Issue {
  severity: Severity;
  count: number;
}

/** Worst severity and number of open findings per element or relation they target. */
export function issuesByItem(findings: readonly Finding[], level: Level): Map<Id, Issue> {
  const map = new Map<Id, Issue>();
  for (const f of findings) {
    if (f.suppressed) continue;
    if (f.severity === 'info' && !showsInfoBadges(level)) continue;
    for (const id of f.targetIds) {
      const prev = map.get(id);
      map.set(
        id,
        prev
          ? {
              severity: RANK[f.severity] < RANK[prev.severity] ? f.severity : prev.severity,
              count: prev.count + 1,
            }
          : { severity: f.severity, count: 1 },
      );
    }
  }
  return map;
}

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) if (!f.suppressed) counts[f.severity]++;
  return counts;
}

/** Findings about one element or relation (as a target), most severe first. */
export function findingsFor(findings: readonly Finding[], id: Id): Finding[] {
  return findings.filter((f) => f.targetIds.includes(id));
}

/**
 * The ops of a quick fix, plus view nodes for elements it adds: inside their parent
 * when the parent is shown, else in a free spot near `near`.
 */
export function quickFixOps(p: Project, view: View, fix: QuickFix, near: Point): Op[] {
  const ops: Op[] = [...fix.ops];
  for (const op of fix.ops) {
    if (op.op !== 'addElement' || view.nodes.some((n) => n.elementId === op.element.id)) continue;
    ops.push({
      op: 'setViewNode',
      viewId: view.id,
      node: { elementId: op.element.id, ...placement(p, view, op.element, near) },
    });
  }
  return ops;
}

function placement(p: Project, view: View, el: Element, near: Point): Point {
  const parent = el.parentId ? elementById(p, el.parentId) : undefined;
  if (parent && view.nodes.some((n) => n.elementId === parent.id)) {
    const siblings = view.nodes.filter((n) => elementById(p, n.elementId)?.parentId === parent.id);
    const bottom = siblings.reduce(
      (y, n) => Math.max(y, n.y + nodeSize(p, view, n.elementId).h + 16),
      CONTAINER_HEADER,
    );
    return { x: CONTAINER_PADDING, y: snap(bottom) };
  }
  return freeSpot(p, view, near, defaultSize(el.kind));
}

/** Elements to show when a finding is focused: its element targets and the ends of its relations. */
export function focusIds(p: Project, f: Finding): Id[] {
  const ids = new Set<Id>();
  for (const id of [...f.targetIds, ...f.relatedIds]) {
    if (elementById(p, id)) ids.add(id);
    const r = p.model.relations.find((x) => x.id === id);
    if (r) {
      ids.add(r.sourceId);
      ids.add(r.targetId);
    }
  }
  return [...ids];
}
