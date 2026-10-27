import { z } from 'zod';
import { IdSchema, IsoSchema } from './common';

export const NoteSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  body: z.string(),
  linkedIds: z.array(IdSchema),
  updatedAt: IsoSchema,
});
export type Note = z.infer<typeof NoteSchema>;

export const DecisionSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  status: z.enum(['proposed', 'accepted', 'superseded', 'rejected']),
  context: z.string(),
  decision: z.string(),
  consequences: z.string(),
  supersededBy: IdSchema.optional(),
  linkedIds: z.array(IdSchema),
  date: IsoSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

export const SuppressionSchema = z.object({
  ruleId: z.string().min(1),
  targetIds: z.array(IdSchema).min(1),
  reason: z.string().min(10, 'A suppression needs a reason of at least 10 characters'),
  decisionId: IdSchema.optional(),
  createdAt: IsoSchema,
});
export type Suppression = z.infer<typeof SuppressionSchema>;

export const ThresholdsSchema = z.object({
  fanOut: z.number().int().positive(),
  fanIn: z.number().int().positive(),
  syncDepth: z.number().int().positive(),
  frontendDirectServices: z.number().int().positive(),
});

export const ProjectSettingsSchema = z.object({
  rulePacks: z.array(z.string().min(1)),
  ruleOverrides: z.record(z.string(), z.enum(['off', 'info', 'warning', 'error'])),
  suppressions: z.array(SuppressionSchema),
  thresholds: ThresholdsSchema,
  palette: z.record(z.string(), z.string()).optional(),
  codeRoot: z.string().optional(),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const SnapshotRefSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  revision: z.number().int().nonnegative(),
  createdAt: IsoSchema,
});
export type SnapshotRef = z.infer<typeof SnapshotRefSchema>;

export const TaskSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  detail: z.string().optional(),
  elementIds: z.array(IdSchema),
  dependsOn: z.array(IdSchema),
  done: z.boolean(),
});
export type Task = z.infer<typeof TaskSchema>;
