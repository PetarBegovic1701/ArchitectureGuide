import { GraphQuery } from '../graph';
import type { Catalog } from '../catalog';
import type { Project, Severity } from '../schema';
import { suppressionKey } from '../serialize';
import { GENERIC_RULES } from './generic';
import type { Finding, Rule } from './types';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Packs that are always on, in addition to the project's profile and its chosen packs. */
export const ALWAYS_ON_PACKS = ['core'];

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Generic rules plus the rules of every profile in the catalog. */
export function allRules(catalog: Catalog): Rule[] {
  return [...GENERIC_RULES, ...catalog.profiles.flatMap((p) => p.rules ?? [])];
}

/**
 * Rules that run for a project (Implementation.md §11.4): rules in an active pack, not
 * switched off, and not replaced by a more specific active rule.
 */
export function activeRules(project: Project, rules: readonly Rule[]): Rule[] {
  const packs = new Set([...ALWAYS_ON_PACKS, project.profile, ...project.settings.rulePacks]);
  const overrides = project.settings.ruleOverrides;
  const candidates = rules.filter(
    (r) => overrides[r.id] !== 'off' && r.packs.some((p) => packs.has(p)),
  );
  const replaced = new Set(candidates.flatMap((r) => r.replaces ?? []));
  return candidates.filter((r) => !replaced.has(r.id));
}

/**
 * Runs the active rules and returns findings, most severe first. Suppressed findings are
 * kept, with their suppression attached, so the UI and exports can show the reason.
 */
export function runRules(
  project: Project,
  catalog: Catalog,
  options: { rules?: readonly Rule[]; only?: readonly string[] } = {},
): Finding[] {
  const graph = new GraphQuery(project, catalog);
  const ctx = { graph, project, settings: project.settings };
  const suppressions = new Map(project.settings.suppressions.map((s) => [suppressionKey(s), s]));
  const findings: Finding[] = [];
  for (const rule of activeRules(project, options.rules ?? allRules(catalog))) {
    if (options.only && !options.only.includes(rule.id)) continue;
    const override = project.settings.ruleOverrides[rule.id];
    const severity: Severity = override && override !== 'off' ? override : rule.severity;
    for (const raw of rule.check(ctx)) {
      const targetIds = [...new Set(raw.targetIds)].sort();
      const finding: Finding = {
        ruleId: rule.id,
        title: rule.title,
        severity,
        message: raw.message,
        targetIds,
        relatedIds: [...new Set(raw.relatedIds ?? [])]
          .filter((id) => !targetIds.includes(id))
          .sort(),
        fixes: raw.fixes ?? [],
        ...(rule.learnId ? { learnId: rule.learnId } : {}),
      };
      const suppressed = suppressions.get(suppressionKey({ ruleId: rule.id, targetIds }));
      findings.push(suppressed ? { ...finding, suppressed } : finding);
    }
  }
  return findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      compare(a.ruleId, b.ruleId) ||
      compare(a.targetIds.join(), b.targetIds.join()),
  );
}
