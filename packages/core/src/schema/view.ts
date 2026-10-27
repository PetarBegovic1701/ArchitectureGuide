import { z } from 'zod';
import { IdSchema, IsoSchema } from './common';

export const ViewNodeSchema = z.object({
  elementId: IdSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  collapsed: z.boolean().optional(),
});
export type ViewNode = z.infer<typeof ViewNodeSchema>;

export const PointSchema = z.object({ x: z.number(), y: z.number() });

export const ViewEdgeSchema = z.object({
  relationId: IdSchema,
  waypoints: z.array(PointSchema).optional(),
  labelPos: z.number().min(0).max(1).optional(),
});
export type ViewEdge = z.infer<typeof ViewEdgeSchema>;

export const AnchorSchema = z.union([
  z.strictObject({ elementId: IdSchema }),
  z.strictObject({ relationId: IdSchema }),
  z.strictObject({
    x: z.number(),
    y: z.number(),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
  }),
]);
export type Anchor = z.infer<typeof AnchorSchema>;

export const ReplySchema = z.object({
  author: z.string().optional(),
  text: z.string().min(1),
  createdAt: IsoSchema,
});

export const AnnotationSchema = z.object({
  id: IdSchema,
  kind: z.enum(['sticky', 'callout', 'comment', 'region']),
  text: z.string(),
  anchor: AnchorSchema,
  color: z.string().optional(),
  replies: z.array(ReplySchema).optional(),
  resolved: z.boolean().optional(),
  author: z.string().optional(),
  createdAt: IsoSchema,
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const ViewKindSchema = z.enum([
  'free',
  'context',
  'container',
  'component',
  'database',
  'scenario',
]);

export const ScenarioSchema = z.object({
  steps: z.array(z.object({ relationId: IdSchema, note: z.string().optional() })),
});

export const ViewSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: ViewKindSchema,
  scopeElementId: IdSchema.optional(),
  nodes: z.array(ViewNodeSchema),
  edges: z.array(ViewEdgeSchema),
  annotations: z.array(AnnotationSchema),
  scenario: ScenarioSchema.optional(),
});
export type View = z.infer<typeof ViewSchema>;

/** View fields that `updateView` may change. Nodes, edges and annotations have their own ops. */
export const ViewMetaSchema = ViewSchema.pick({
  name: true,
  kind: true,
  scopeElementId: true,
  scenario: true,
});
