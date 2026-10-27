import type { GraphQuery } from '../graph';
import type { Id, ModelOp, Project, ProjectSettings, Severity, Suppression } from '../schema';

/** A one-click change that resolves (or documents) a finding. Applied as one undo step. */
export interface QuickFix {
  title: string;
  ops: ModelOp[];
}

/** What a rule's check returns for one problem. */
export interface RawFinding {
  /** Stable subject of the finding; suppressions match on rule ID + these IDs. */
  targetIds: Id[];
  /** Other items to highlight (relations involved, the other services ...). */
  relatedIds?: Id[];
  message: string;
  fixes?: QuickFix[];
}

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  message: string;
  targetIds: Id[];
  relatedIds: Id[];
  fixes: QuickFix[];
  /** Learning text that explains the idea behind the rule. */
  learnId?: string;
  suppressed?: Suppression;
}

export interface RuleContext {
  graph: GraphQuery;
  project: Project;
  settings: ProjectSettings;
}

/** One anti-pattern detector (Implementation.md §11.1). */
export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  /** The rule runs when any of these packs is active. */
  packs: string[];
  /** When this rule runs, the listed (more generic) rules do not. */
  replaces?: string[];
  /** Markdown: why this is a problem and what to do instead. */
  rationale: string;
  learnId?: string;
  /** The rule as a MUST / MUST NOT sentence for agent exports (§18.1). */
  invariant?: string | ((settings: ProjectSettings) => string);
  /** Concept selectors the rule is about; the invariant is exported only when one matches. */
  appliesTo?: string[];
  check(ctx: RuleContext): RawFinding[];
}

export interface RulePack {
  id: string;
  name: string;
  description: string;
}
