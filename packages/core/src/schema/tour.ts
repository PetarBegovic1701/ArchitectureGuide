import { z } from 'zod';
import { IdSchema } from './common';

/** Who a tour or a learning text is written for. */
export const AudienceSchema = z.enum(['any', 'beginner', 'intermediate', 'senior', 'agent']);
export type Audience = z.infer<typeof AudienceSchema>;

export const TourStepSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  /** Markdown. */
  body: z.string(),
  /** View to open; defaults to the current view. */
  viewId: IdSchema.optional(),
  /** Elements and relations to highlight and zoom to. */
  elementIds: z.array(IdSchema),
  relationIds: z.array(IdSchema),
  /** Concept, relation-type or topic IDs whose learning texts the step links to. */
  conceptIds: z.array(z.string().min(1)).optional(),
});
export type TourStep = z.infer<typeof TourStepSchema>;

/** A guided walkthrough of a project, for onboarding people and agents (Implementation.md §17). */
export const TourSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  audience: AudienceSchema,
  steps: z.array(TourStepSchema).min(1),
});
export type Tour = z.infer<typeof TourSchema>;
