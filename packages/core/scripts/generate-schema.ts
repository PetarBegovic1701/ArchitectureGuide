// Writes schema/archguide.schema.json from the Zod project schema.
// `--check` fails when the committed file is out of date (used in CI).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ProjectSchema, SCHEMA_VERSION } from '../src/schema';

const target = fileURLToPath(new URL('../../../schema/archguide.schema.json', import.meta.url));

const schema = {
  ...z.toJSONSchema(ProjectSchema, { target: 'draft-2020-12', io: 'input' }),
  $id: `https://archguide.dev/schema/v${SCHEMA_VERSION}/project.json`,
  title: 'ArchitectureGuide project',
  description:
    'An architecture model: elements, relations, views, notes, decisions and change sets.',
};
const text = `${JSON.stringify(schema, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // Missing file counts as out of date.
  }
  if (current !== text) {
    console.error('schema/archguide.schema.json is out of date. Run: pnpm schema');
    process.exit(1);
  }
  console.log('schema/archguide.schema.json is up to date.');
} else {
  writeFileSync(target, text);
  console.log(`Wrote ${target}`);
}
