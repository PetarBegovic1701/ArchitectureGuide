import { z } from 'zod';
import { IdSchema, IsoSchema } from './common';
import { ElementSchema, RelationSchema } from './model';
import { AnnotationSchema, ViewEdgeSchema, ViewNodeSchema, ViewSchema } from './view';
import { DecisionSchema, NoteSchema, SuppressionSchema, TaskSchema } from './records';

/**
 * Patches are merged shallowly into the target. A `null` value removes the field.
 * The merged result is validated with the full schema, so a patch cannot break an item.
 */
const PatchSchema = z.record(z.string(), z.unknown());

/** Ops that change the model, views, notes, decisions and settings. Change sets hold these. */
export const ModelOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addElement'), element: ElementSchema }),
  z.object({ op: z.literal('updateElement'), id: IdSchema, patch: PatchSchema }),
  z.object({ op: z.literal('removeElement'), id: IdSchema, cascade: z.boolean().optional() }),
  z.object({ op: z.literal('moveElement'), id: IdSchema, parentId: IdSchema.nullable() }),
  z.object({ op: z.literal('addRelation'), relation: RelationSchema }),
  z.object({ op: z.literal('updateRelation'), id: IdSchema, patch: PatchSchema }),
  z.object({ op: z.literal('removeRelation'), id: IdSchema }),
  z.object({ op: z.literal('renameId'), from: IdSchema, to: IdSchema }),
  z.object({ op: z.literal('addView'), view: ViewSchema }),
  z.object({ op: z.literal('updateView'), id: IdSchema, patch: PatchSchema }),
  z.object({ op: z.literal('removeView'), id: IdSchema }),
  z.object({ op: z.literal('setViewNode'), viewId: IdSchema, node: ViewNodeSchema }),
  z.object({ op: z.literal('removeViewNode'), viewId: IdSchema, elementId: IdSchema }),
  z.object({ op: z.literal('setViewEdge'), viewId: IdSchema, edge: ViewEdgeSchema }),
  z.object({ op: z.literal('removeViewEdge'), viewId: IdSchema, relationId: IdSchema }),
  z.object({ op: z.literal('upsertAnnotation'), viewId: IdSchema, annotation: AnnotationSchema }),
  z.object({ op: z.literal('removeAnnotation'), viewId: IdSchema, id: IdSchema }),
  z.object({ op: z.literal('upsertNote'), note: NoteSchema }),
  z.object({ op: z.literal('removeNote'), id: IdSchema }),
  z.object({ op: z.literal('upsertDecision'), decision: DecisionSchema }),
  z.object({ op: z.literal('removeDecision'), id: IdSchema }),
  z.object({ op: z.literal('upsertSuppression'), suppression: SuppressionSchema }),
  z.object({
    op: z.literal('removeSuppression'),
    ruleId: z.string().min(1),
    targetIds: z.array(IdSchema).min(1),
  }),
  z.object({ op: z.literal('updateProject'), patch: PatchSchema }),
  z.object({ op: z.literal('updateSettings'), patch: PatchSchema }),
]);
export type ModelOp = z.infer<typeof ModelOpSchema>;

export const ChangeSetSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(['draft', 'ready', 'implemented', 'abandoned']),
  baseRevision: z.number().int().nonnegative(),
  ops: z.array(ModelOpSchema),
  tasks: z.array(TaskSchema).optional(),
  createdAt: IsoSchema,
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

/** All ops. Change-set ops hold model ops only, so ops never nest more than one level. */
export const OpSchema = z.discriminatedUnion('op', [
  ...ModelOpSchema.options,
  z.object({ op: z.literal('upsertChangeSet'), changeSet: ChangeSetSchema }),
  z.object({ op: z.literal('removeChangeSet'), id: IdSchema }),
]);
export type Op = z.infer<typeof OpSchema>;
export type OpName = Op['op'];
