import type { StackProfile } from '@archguide/core';
import { CONCEPTS } from './concepts';
import { RELATION_RULES, RELATION_TYPES } from './relations';

export const PROFILE_ID = 'react-node-postgres';

/** React + Node.js + PostgreSQL stack profile (Implementation.md §2). */
export const profile: StackProfile = {
  id: PROFILE_ID,
  name: 'React + Node.js + PostgreSQL',
  version: '0.1.0',
  concepts: CONCEPTS,
  relationTypes: RELATION_TYPES,
  relationRules: RELATION_RULES,
};

export { CONCEPTS, RELATION_RULES, RELATION_TYPES };
