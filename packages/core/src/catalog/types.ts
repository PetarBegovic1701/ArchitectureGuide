import type { ZodType } from 'zod';
import type { Layer } from '../schema';
import type { LearningDoc, Lesson } from '../learn/schema';

export const CATEGORY_IDS = [
  'deployable',
  'module',
  'ui',
  'domain-core',
  'domain-object',
  'port',
  'adapter',
  'schema',
  'data-at-rest',
  'data-in-motion',
  'client-state',
  'event',
  'routing',
  'security',
  'actor',
  'external',
  'group',
  'cross-cutting',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export const SHAPE_IDS = [
  'rect',
  'rounded',
  'window',
  'hexagon',
  'hexagon-sm',
  'circle',
  'plug',
  'cylinder',
  'cylinder-dashed',
  'pipe',
  'triangle',
  'diamond',
  'octagon',
  'actor',
  'cloud',
  'gear',
  'document',
  'container',
] as const;
export type ShapeId = (typeof SHAPE_IDS)[number];

export const PALETTE_GROUPS = [
  'Frontend',
  'Backend',
  'Data',
  'Infra',
  'Events',
  'Groups',
  'Generic',
] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/**
 * Selects concepts:
 * - `"*"`: any concept
 * - `"node.service"`: one concept
 * - `"pg.*"`: every concept with this prefix
 * - `"category:data-at-rest"`: every concept in a category
 * - `"group:Frontend"`: every concept in a palette group
 * In `allowedParents` only, `"top"` means "no parent".
 */
export type Selector = string;

export interface Category {
  id: CategoryId;
  name: string;
  shape: ShapeId;
  defaultLayer?: Layer;
}

export interface Concept {
  id: string;
  name: string;
  category: CategoryId;
  /** Overrides the category shape. */
  shape?: ShapeId;
  /** Lucide icon name. */
  icon: string;
  /** First ID segment of elements of this concept ("svc" → "svc.orders"). */
  idPrefix: string;
  defaultLayer?: Layer;
  allowedParents: Selector[];
  /** Shown when a nesting is refused. */
  nestingHint?: string;
  /** Validates `Element.properties`. Unknown keys are allowed. */
  propertySchema?: ZodType;
  palette: { group: PaletteGroup; order: number; basic: boolean };
  /** Markdown: what it is, when to use it. */
  docs: string;
  /** Search aliases for the palette ("prisma" finds Repository). */
  aliases?: string[];
}

export interface LineStyle {
  dash?: string;
  width: 1 | 1.5 | 2.5;
  marker: 'arrow' | 'open-arrow' | 'triangle-hollow' | 'diamond-tail' | 'none';
  curved?: boolean;
}

export interface RelationType {
  id: string;
  name: string;
  /** static = compile-time or structural. */
  mode: 'sync' | 'async' | 'static';
  specializes?: string;
  line: LineStyle;
  /** Lower comes first in the relation picker. */
  defaultPriority: number;
  /** Shown when no allow rule matches a pair. */
  hint?: string;
  /** Validates `Relation.properties`. Unknown keys are allowed. */
  propertySchema?: ZodType;
  docs: string;
}

/** Allows `type` from any `from` concept to any `to` concept. */
export interface AllowRule {
  type: string | string[];
  from: Selector[];
  to: Selector[];
  allowSelf?: boolean;
  /** Overrides the type's `defaultPriority` for pairs this rule matches. */
  priority?: number;
}

/** Blocks `type` ("*" = every type) for matching pairs. A deny rule wins over every allow rule. */
export interface DenyRule {
  type: string | string[];
  deny: { from?: Selector[]; to?: Selector[] };
  message: string;
}

export type RelationRule = AllowRule | DenyRule;

export function isDenyRule(rule: RelationRule): rule is DenyRule {
  return 'deny' in rule;
}

/** A plug-in with stack-specific knowledge (Implementation.md §2, §9.1). */
export interface StackProfile {
  id: string;
  name: string;
  version: string;
  concepts: Concept[];
  relationTypes: RelationType[];
  /** Checked before core rules, so profile deny messages win. */
  relationRules: RelationRule[];
  /** Learning texts and lessons (Implementation.md §17). */
  content?: { docs: readonly LearningDoc[]; lessons: readonly Lesson[] };
}
