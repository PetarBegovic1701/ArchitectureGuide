import { placeMissingOps } from '@archguide/core';
import type { Id, Op, Project, View } from '@archguide/core';
import { catalog } from './catalog';

/**
 * Ops that show every element and relation of the model that the view does not show yet
 * (lesson start models and "Show me" only change the model). See `placeMissingOps`.
 */
export function placeOps(p: Project, view: View): Op[] {
  return placeMissingOps(p, catalog, view.id);
}

/** IDs of elements that `ops` add. */
export const addedElementIds = (ops: readonly Op[]): Id[] =>
  ops.flatMap((op) => (op.op === 'addElement' ? [op.element.id] : []));
