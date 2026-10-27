import { z } from 'zod';

/** Readable, stable ID: lowercase segments separated by "." or "-" ("svc.orders", "rel.app-web-calls-svc-api"). */
export const IdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'IDs use lowercase letters, digits, "." and "-"')
  .max(128);
export type Id = z.infer<typeof IdSchema>;

export const IsoSchema = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);
export type Iso = z.infer<typeof IsoSchema>;

export const StatusSchema = z.enum(['existing', 'planned', 'deprecated']);
export type Status = z.infer<typeof StatusSchema>;

export const LayerSchema = z.enum([
  'presentation',
  'application',
  'domain',
  'infrastructure',
  'data',
  'external',
]);
export type Layer = z.infer<typeof LayerSchema>;

export const SeveritySchema = z.enum(['error', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

export const EvidenceSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  symbol: z.string().optional(),
  detector: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ProvenanceSchema = z.object({
  origin: z.enum(['manual', 'inferred', 'template']),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(EvidenceSchema).optional(),
  reviewed: z.boolean().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
