import type { Id, Op } from '../schema';

export const OP_ERROR_CODES = [
  'SCHEMA_INVALID',
  'ID_EXISTS',
  'ID_NOT_FOUND',
  'UNKNOWN_KIND',
  'UNKNOWN_RELATION',
  'RELATION_NOT_ALLOWED',
  'NESTING_NOT_ALLOWED',
  'NESTING_CYCLE',
  'SELF_RELATION',
  'PROPERTY_INVALID',
  'HAS_DEPENDENTS',
  'REVISION_CONFLICT',
] as const;
export type OpErrorCode = (typeof OP_ERROR_CODES)[number];

export interface OpError {
  /** Index of the failing op in the batch. */
  index: number;
  code: OpErrorCode;
  itemId?: Id;
  message: string;
  hint?: string;
  /** Ops that would do what was probably meant (for example the flipped relation). */
  fix?: Op[];
}

/** Thrown inside op handlers; `applyOps` turns it into an `OpError`. */
export class OpFailure extends Error {
  constructor(
    readonly code: OpErrorCode,
    message: string,
    readonly extra: { itemId?: Id; hint?: string; fix?: Op[] } = {},
  ) {
    super(message);
  }
}
