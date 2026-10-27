import { z } from 'zod';
import { IdSchema, LayerSchema, ProvenanceSchema, StatusSchema } from './common';

/** Concept IDs look like "node.service", "pg.schema", "gen.actor", "group.layer". */
export const KindSchema = z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/, 'Unknown concept ID format');

export const QualitiesSchema = z.object({
  sensitivity: z.enum(['public', 'internal', 'pii', 'secret']).optional(),
  criticality: z.enum(['low', 'medium', 'high']).optional(),
  scaling: z.enum(['single', 'horizontal', 'serverless']).optional(),
  sla: z.string().optional(),
  slow: z.boolean().optional(),
});
export type Qualities = z.infer<typeof QualitiesSchema>;

export const ElementSchema = z.object({
  id: IdSchema,
  kind: KindSchema,
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  parentId: IdSchema.optional(),
  layer: LayerSchema.optional(),
  tech: z.string().optional(),
  responsibilities: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  color: z.string().optional(),
  status: StatusSchema,
  owner: z.string().optional(),
  qualities: QualitiesSchema.optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  codePaths: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
  source: ProvenanceSchema.optional(),
});
export type Element = z.infer<typeof ElementSchema>;

/** Relation type IDs look like "calls", "migrates", "replicates-to". */
export const RelationTypeIdSchema = z.string().regex(/^[a-z]+(?:-[a-z]+)*$/);

export const RelationSchema = z.object({
  id: IdSchema,
  type: RelationTypeIdSchema,
  sourceId: IdSchema,
  targetId: IdSchema,
  label: z.string().optional(),
  mode: z.enum(['sync', 'async']).optional(),
  protocol: z.string().optional(),
  via: z.string().optional(),
  inTransaction: z.boolean().optional(),
  contract: z.string().optional(),
  /** Validated by the relation type's propertySchema (isolation, auth, retries ...). */
  properties: z.record(z.string(), z.unknown()).optional(),
  status: StatusSchema,
  notes: z.string().optional(),
  source: ProvenanceSchema.optional(),
});
export type Relation = z.infer<typeof RelationSchema>;

export const ModelSchema = z.object({
  elements: z.array(ElementSchema),
  relations: z.array(RelationSchema),
});
export type Model = z.infer<typeof ModelSchema>;
