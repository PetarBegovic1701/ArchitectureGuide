import { z } from 'zod';
import { IdSchema } from '../schema';
import { ModelOpSchema } from '../schema/ops';

/** Experience level of a reader or a text (Implementation.md §17.2). */
export const LevelSchema = z.enum(['beginner', 'intermediate', 'senior']);
export type Level = z.infer<typeof LevelSchema>;

/** Learning tracks (Implementation.md §17.3). */
export const TrackSchema = z.enum([
  'foundations',
  'data-and-models',
  'api-design',
  'state-management',
  'auth',
  'concurrency-and-parallelism',
  'patterns',
  'operations',
]);
export type Track = z.infer<typeof TrackSchema>;

/**
 * IDs of learning texts: a concept ("pg.function"), a relation type ("invokes"),
 * a rule ("RNP-007") or a topic ("topic.isolation-levels").
 */
export const ContentIdSchema = z
  .string()
  .regex(/^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*|[A-Z]+-\d{3})$/, 'Not a valid content ID');

export const DocKindSchema = z.enum(['concept', 'relation', 'rule', 'topic', 'pattern']);

export const CodeExampleSchema = z.object({
  title: z.string().optional(),
  language: z.string().min(1),
  code: z.string().min(1),
});
export type CodeExample = z.infer<typeof CodeExampleSchema>;

export const QuizQuestionSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
    /** Index of the correct option. */
    answer: z.number().int().nonnegative(),
    explanation: z.string().min(1),
  })
  .refine((q) => q.answer < q.options.length, { message: 'answer must index an option' });
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const ReferenceSchema = z.object({ title: z.string().min(1), url: z.url() });

/** One learning text, written as a Markdown file with front matter (Implementation.md §17.4). */
export const LearningDocSchema = z.object({
  id: ContentIdSchema,
  kind: DocKindSchema,
  title: z.string().min(1),
  /** One sentence, shown in tooltips and agent primers. */
  summary: z.string().min(1).max(200),
  /** The level the text starts at. */
  level: LevelSchema,
  tracks: z.array(TrackSchema).min(1),
  tags: z.array(z.string().min(1)).optional(),
  explain: z.object({
    beginner: z.string().min(1),
    intermediate: z.string().min(1).optional(),
    senior: z.string().min(1),
  }),
  analogy: z.string().optional(),
  whenToUse: z.array(z.string().min(1)).optional(),
  whenNotToUse: z.array(z.string().min(1)).optional(),
  tradeoffs: z.array(z.string().min(1)).optional(),
  mistakes: z.array(z.string().min(1)).optional(),
  examples: z.array(CodeExampleSchema).optional(),
  related: z.array(ContentIdSchema),
  references: z.array(ReferenceSchema),
  quiz: z.array(QuizQuestionSchema).optional(),
  /** Path of the source file, for error messages. */
  source: z.string().optional(),
});
export type LearningDoc = z.infer<typeof LearningDocSchema>;

// --- checks ------------------------------------------------------------------

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

/** Matches one value: equal to a scalar, one of a list, present/absent, or containing a text. */
export const ValueMatchSchema = z.union([
  Scalar,
  z.strictObject({ in: z.array(Scalar).min(1) }),
  z.strictObject({ exists: z.boolean() }),
  z.strictObject({ includes: z.string().min(1) }),
]);
export type ValueMatch = z.infer<typeof ValueMatchSchema>;

/** Field matches by dotted path: `{ "properties.concurrencyControl": { in: [...] } }`. */
export const WhereSchema = z.record(z.string().min(1), ValueMatchSchema);

export interface ElementMatch {
  id?: string;
  /** Concept selector: "node.service", "pg.*", "category:data-at-rest", "group:Frontend". */
  kind?: string;
  /** Case-insensitive part of the element name. */
  nameIncludes?: string;
  parent?: ElementMatch;
  where?: Record<string, ValueMatch>;
}

export const ElementMatchSchema: z.ZodType<ElementMatch> = z.lazy(() =>
  z.strictObject({
    id: z.string().optional(),
    kind: z.string().optional(),
    nameIncludes: z.string().optional(),
    parent: ElementMatchSchema.optional(),
    where: WhereSchema.optional(),
  }),
);

export const RelationMatchSchema = z.strictObject({
  type: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  from: ElementMatchSchema.optional(),
  to: ElementMatchSchema.optional(),
  where: WhereSchema.optional(),
});
export type RelationMatch = z.infer<typeof RelationMatchSchema>;

const Count = {
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
};
const Message = { message: z.string().optional() };

/**
 * A condition on a project model. Lessons use checks to see whether a step is done
 * (Implementation.md §17.5).
 */
export type Check =
  | { hasElement: ElementMatch; min?: number; max?: number; message?: string }
  | { hasRelation: RelationMatch; min?: number; max?: number; message?: string }
  | { noPath: { from: ElementMatch; to: ElementMatch; types?: string[] }; message?: string }
  | { finding: { ruleId: string; present: boolean }; message?: string }
  | { all: Check[]; message?: string }
  | { any: Check[]; message?: string }
  | { not: Check; message?: string };

export const CheckSchema: z.ZodType<Check> = z.lazy(() =>
  z.union([
    z.strictObject({ hasElement: ElementMatchSchema, ...Count, ...Message }),
    z.strictObject({ hasRelation: RelationMatchSchema, ...Count, ...Message }),
    z.strictObject({
      noPath: z.strictObject({
        from: ElementMatchSchema,
        to: ElementMatchSchema,
        types: z.array(z.string()).optional(),
      }),
      ...Message,
    }),
    z.strictObject({
      finding: z.strictObject({ ruleId: z.string().min(1), present: z.boolean() }),
      ...Message,
    }),
    z.strictObject({ all: z.array(CheckSchema).min(1), ...Message }),
    z.strictObject({ any: z.array(CheckSchema).min(1), ...Message }),
    z.strictObject({ not: CheckSchema, ...Message }),
  ]),
);

// --- lessons -----------------------------------------------------------------

export const LessonStepSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  /** Markdown: what to do and why. */
  body: z.string().min(1),
  /** When the step is done. A step without a check is a reading step. */
  check: CheckSchema.optional(),
  hints: z.array(z.string().min(1)).optional(),
  /** Markdown shown after the check passes: what the learner just did. */
  success: z.string().optional(),
  /** Ops that complete the step ("Show me"). Tests apply them to prove the lesson is solvable. */
  solution: z.array(ModelOpSchema).optional(),
  /** Element IDs to highlight. */
  focus: z.array(IdSchema).optional(),
});
export type LessonStep = z.infer<typeof LessonStepSchema>;

/** An interactive lesson, written as a YAML file (Implementation.md §17.5). */
export const LessonSchema = z.object({
  id: z
    .string()
    .regex(/^lesson\.[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lesson IDs look like "lesson.first-full-stack"'),
  title: z.string().min(1),
  summary: z.string().min(1).max(300),
  track: TrackSchema,
  level: LevelSchema,
  minutes: z.number().int().positive(),
  profile: z.string().min(1),
  /** Learning texts the lesson teaches; linked from the lesson page. */
  conceptIds: z.array(ContentIdSchema).min(1),
  /** The model the lesson starts from. Empty list = empty canvas. */
  start: z.object({ ops: z.array(ModelOpSchema) }),
  steps: z.array(LessonStepSchema).min(1),
  source: z.string().optional(),
});
export type Lesson = z.infer<typeof LessonSchema>;
