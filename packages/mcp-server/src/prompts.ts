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

  server.registerPrompt(
    'map-repository',
    {
      title: 'Map this repository',
      description:
        'Draft the architecture model from the code, review it, and write ARCHITECTURE.md.',
      argsSchema: { projectName: z.string().optional() },
    },
    ({ projectName }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Map this repository into the architecture model.',
              '',
              '1. Run analyze_repository. Read the summary: packages, elements by kind, findings, warnings.',
              '2. Open the top evidence files of the deployables and of anything with low confidence, and confirm what they are (services, apps, workers, layers).',
              `3. If list_projects shows no project, create_project${projectName ? ` with name "${projectName}"` : ''}.`,
              '4. apply_analysis with minConfidence 0.6. Then correct it with upsert_elements / upsert_relations: real names, responsibilities, and relations the code hides.',
              '5. validate_project. Fix findings, or suppress_finding with a real reason.',
              '6. export with format "agent-md" and write: true; generate_enforcement with write: true.',
              '7. Report what was inferred and still needs a human review (the items with source.reviewed false), and the findings left open.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'review-change',
    {
      title: 'Review a change against the architecture',
      description:
        'Compare the code with the model and report invariant violations with file and line.',
      argsSchema: {
        baseRef: z.string().optional().describe('The branch or commit the change starts from.'),
      },
    },
    ({ baseRef }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Review the current change${baseRef ? ` (against ${baseRef})` : ''} against the architecture model.`,
              '',
              '1. Run diff_with_repository.',
              `2. Report every finding and every invariant (get_architecture, "Invariants") the change breaks, with file and line.${baseRef ? ` Use git diff ${baseRef} to tell new problems from old ones.` : ''}`,
              '3. For each: propose the code fix, or, when the code is right and the model is behind, the model update (upsert_elements, upsert_relations, or apply_analysis for new items).',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
