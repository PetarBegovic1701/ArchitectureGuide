import type { Finding } from '../rules';
import type { Evidence, Id, Model, Op } from '../schema';

/** Kinds of facts detectors report (Implementation.md §19.3). */
export type FactType =
  | 'package'
  | 'deployable'
  | 'framework'
  | 'route'
  | 'handler'
  | 'middleware'
  | 'module'
  | 'layer-folder'
  | 'state'
  | 'api-client'
  | 'http-call'
  | 'external-sdk'
  | 'db-database'
  | 'db-schema'
  | 'db-table'
  | 'db-fk'
  | 'db-index'
  | 'migrations'
  | 'orm-usage'
  | 'job-queue'
  | 'job-producer'
  | 'job-consumer'
  | 'notify'
  | 'listen'
  | 'compose-service'
  | 'env-var'
  | 'import'
  | 'import-violation'
  | 'cycle'
  | 'validation';

/** The element a fact proposes. Facts with the same subject become one candidate. */
export interface ElementProposal {
  kind: string;
  name: string;
  /** Subject of the parent's fact. */
  parent?: string;
  codePaths?: string[];
  tech?: string;
  layer?: string;
  properties?: Record<string, unknown>;
}

/** The relation a fact proposes, between two subjects. */
export interface RelationProposal {
  type: string;
  from: string;
  to: string;
  label?: string;
  protocol?: string;
  via?: string;
  inTransaction?: boolean;
  properties?: Record<string, unknown>;
}

export interface Fact {
  type: FactType;
  /** Stable key, for example "pkg:services/orders", "table:orders.order". */
  subject: string;
  data: Record<string, unknown>;
  evidence: Evidence[];
  /** 0..1 */
  confidence: number;
  detector: string;
  element?: ElementProposal;
  relation?: RelationProposal;
}

export interface AnalysisDiff {
  /** Candidates with no match in the model. */
  newInCode: Id[];
  /** Model elements (status existing, of a kind the analyzer detects) with no candidate. */
  missingInCode: Id[];
  changed: { id: Id; fields: string[] }[];
  /** Ops that bring the model in line with the code. Never removes anything. */
  suggestedOps: Op[];
  /** Candidate ID → model ID for every matched candidate. */
  matches: Record<Id, Id>;
}

/** A finding of an analysis rule: about code, so it carries file and line evidence. */
export type AnalysisFinding = Finding & { evidence: Evidence[] };

export interface AnalysisResult {
  repoRoot: string;
  analyzedAt: string;
  durationMs: number;
  stats: { files: number; packages: number; facts: number; cachedFiles: number };
  facts: Fact[];
  /** The draft model: every element and relation has `source.origin: 'inferred'`. */
  candidates: Model;
  /** Fact subject → candidate element ID. */
  subjects: Record<string, Id>;
  findings: AnalysisFinding[];
  diff?: AnalysisDiff;
  /** Limits hit, parse errors, dropped candidates. */
  warnings: string[];
}
