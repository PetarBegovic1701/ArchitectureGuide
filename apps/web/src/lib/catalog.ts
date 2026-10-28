import { CATEGORIES, SHAPES, createCatalog, shapeOf } from '@archguide/core';
import type { Concept, Layer, LearningDoc, Lesson, ShapeId } from '@archguide/core';
import { PROFILE_ID, profile } from '@archguide/profile-react-node-postgres';

/** The one catalog the app uses: core concepts + the React/Node/PostgreSQL profile. */
export const catalog = createCatalog([profile]);
export const DEFAULT_PROFILE = PROFILE_ID;

export const docs: ReadonlyMap<string, LearningDoc> = new Map(
  (profile.content?.docs ?? []).map((d) => [d.id, d]),
);

export const lessons: ReadonlyMap<string, Lesson> = new Map(
  (profile.content?.lessons ?? []).map((l) => [l.id, l]),
);

export function conceptOf(kind: string): Concept | undefined {
  return catalog.concepts.get(kind);
}

export function shapeFor(kind: string): ShapeId {
  const concept = conceptOf(kind);
  return concept ? shapeOf(concept) : 'rect';
}

export function defaultSize(kind: string): { w: number; h: number } {
  const spec = SHAPES[shapeFor(kind)];
  return { w: spec.width, h: spec.height };
}

export function defaultLayer(kind: string): Layer | undefined {
  const concept = conceptOf(kind);
  if (!concept) return undefined;
  return concept.defaultLayer ?? CATEGORIES[concept.category].defaultLayer;
}

export function isGroupKind(kind: string): boolean {
  return conceptOf(kind)?.category === 'group';
}
