import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runStdio } from './server';

/** `archguide-mcp [--workspace <dir>] [--read-only]` (Implementation.md §20). */
const { values } = parseArgs({
  options: {
    workspace: { type: 'string', default: './architecture' },
    'read-only': { type: 'boolean', default: false },
  },
});

await runStdio({ workspace: resolve(values.workspace), readOnly: values['read-only'] });
