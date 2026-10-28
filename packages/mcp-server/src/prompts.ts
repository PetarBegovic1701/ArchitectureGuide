import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from './context';

/** Prompts (Implementation.md §20.4). Change sets come in Phase 9; until then edits apply directly. */
export function registerPrompts(server: McpServer, _ctx: McpContext): void {
  server.registerPrompt(
    'plan-feature',
    {
      title: 'Plan a feature in the architecture',
      description:
        'Read the architecture, add what a feature needs, check the rules, and explain the plan.',
      argsSchema: {
        feature: z.string().describe('What the feature does, in a sentence or two.'),
        projectId: z.string().optional(),
      },
    },
    ({ feature, projectId }) => {
      const project = projectId ? ` (projectId "${projectId}")` : '';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Plan this feature in the architecture model${project}: ${feature}`,
                '',
                '1. Read the model with get_architecture (agent-md). Use focus on the area the feature touches.',
                '2. Find the concepts you need with get_catalog (filter by prefix, e.g. "node." or "react."). If you are unsure what a concept is for, use explain_concept.',
                '3. Add the elements with upsert_elements and connect them with upsert_relations. Reuse existing elements; mark new ones status "planned".',
                '4. Read the findings each change returns. Fix errors with apply_quick_fix or a better design; suppress a finding only with a real reason.',
                '5. Record important choices with add_decision.',
                '6. Finish with validate_project and summarize: the new elements and relations, the data each service owns, and the findings left open and why.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );
}
