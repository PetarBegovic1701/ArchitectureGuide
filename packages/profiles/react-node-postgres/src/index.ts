import type { StackProfile } from '@archguide/core';
import { CONCEPTS } from './concepts';
import { RELATION_RULES, RELATION_TYPES } from './relations';
import { DOCS, LESSONS } from './content.generated';
import { RULES } from './rules';
import { TEMPLATES } from './templates';

export const PROFILE_ID = 'react-node-postgres';

/** React + Node.js + PostgreSQL stack profile (Implementation.md §2). */
export const profile: StackProfile = {
  id: PROFILE_ID,
  name: 'React + Node.js + PostgreSQL',
  version: '0.1.0',
  concepts: CONCEPTS,
  relationTypes: RELATION_TYPES,
  relationRules: RELATION_RULES,
  rules: RULES,
  templates: TEMPLATES,
  content: { docs: DOCS, lessons: LESSONS },
};

export { CONCEPTS, DOCS, LESSONS, RELATION_RULES, RELATION_TYPES, RULES, TEMPLATES };
