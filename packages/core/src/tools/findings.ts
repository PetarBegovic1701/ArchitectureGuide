import type { Finding } from '../rules';

/** Identifies a finding across runs: the rule and what it is about. */
export function findingKey(f: Pick<Finding, 'ruleId' | 'targetIds'>): string {
  return `${f.ruleId}|${[...f.targetIds].sort().join(',')}`;
}

/** Findings in `after` that `before` did not have: what a change introduced (§20.1). */
export function newFindings(before: readonly Finding[], after: readonly Finding[]): Finding[] {
  const known = new Set(before.map(findingKey));
  return after.filter((f) => !known.has(findingKey(f)));
}

/** Counts by severity, for short summaries. */
export function countFindings(findings: readonly Finding[]): Record<Finding['severity'], number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) if (!f.suppressed) counts[f.severity]++;
  return counts;
}
