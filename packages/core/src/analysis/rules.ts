import type { Catalog } from '../catalog';
import type { Evidence, Id, Model, Severity } from '../schema';
import type { Ownership } from './ownership';
import type { AnalysisFinding, Fact, FactType } from './types';

/** What an analysis rule sees: the facts, the candidates and the ownership map. */
export interface AnalysisContext {
  facts: readonly Fact[];
  of(type: FactType): Fact[];
  candidates: Model;
  /** Candidate element ID for a fact subject; the subject itself when there is none. */
  idOf(subject: string): Id;
  ownership: Ownership;
  catalog: Catalog;
}

export interface RawAnalysisFinding {
  targetIds: Id[];
  relatedIds?: Id[];
  message: string;
  evidence: Evidence[];
}

/** A rule about code (Implementation.md §11.6, scope "analysis"), with file and line evidence. */
export interface AnalysisRule {
  id: string;
  title: string;
  severity: Severity;
  learnId?: string;
  rationale: string;
  check(ctx: AnalysisContext): RawAnalysisFinding[];
}

export function analysisContext(
  facts: readonly Fact[],
  candidates: Model,
  subjects: Record<string, Id>,
  ownership: Ownership,
  catalog: Catalog,
): AnalysisContext {
  const byType = new Map<FactType, Fact[]>();
  for (const f of facts) byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
  return {
    facts,
    of: (type) => byType.get(type) ?? [],
    candidates,
    idOf: (subject) => subjects[subject] ?? subject,
    ownership,
    catalog,
  };
}

/** Runs analysis rules; findings are sorted by severity, rule and first target. */
export function runAnalysisRules(
  rules: readonly AnalysisRule[],
  ctx: AnalysisContext,
): AnalysisFinding[] {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  const out: AnalysisFinding[] = [];
  for (const rule of rules)
    for (const raw of rule.check(ctx))
      out.push({
        ruleId: rule.id,
        title: rule.title,
        severity: rule.severity,
        message: raw.message,
        targetIds: raw.targetIds,
        relatedIds: raw.relatedIds ?? [],
        fixes: [],
        evidence: raw.evidence.slice(0, 10),
        ...(rule.learnId ? { learnId: rule.learnId } : {}),
      });
  return out.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      (a.targetIds[0] ?? '').localeCompare(b.targetIds[0] ?? ''),
  );
}
