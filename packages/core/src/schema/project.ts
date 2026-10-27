import { z } from 'zod';
import { IdSchema, IsoSchema } from './common';
import { ModelSchema } from './model';
import { ViewSchema } from './view';
import { ChangeSetSchema } from './ops';
import { TourSchema } from './tour';
import { DecisionSchema, NoteSchema, ProjectSettingsSchema, SnapshotRefSchema } from './records';

export const SCHEMA_VERSION = 1;

export const DerivedFromSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  rootIds: z.array(IdSchema),
  /** The template's invariants with its parameters filled in; exported to agents. */
  invariants: z.array(z.string().min(1)).optional(),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  profile: z.string().min(1),
  createdAt: IsoSchema,
  updatedAt: IsoSchema,
  derivedFrom: z.array(DerivedFromSchema).optional(),
  model: ModelSchema,
  views: z.array(ViewSchema),
  notes: z.array(NoteSchema),
  decisions: z.array(DecisionSchema),
  tours: z.array(TourSchema),
  changeSets: z.array(ChangeSetSchema),
  snapshots: z.array(SnapshotRefSchema),
  settings: ProjectSettingsSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

/** Project fields that `updateProject` may change. */
export const ProjectMetaSchema = ProjectSchema.pick({
  name: true,
  description: true,
  profile: true,
  derivedFrom: true,
});
