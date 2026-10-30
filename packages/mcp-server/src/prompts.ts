import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from './context';

/** Prompts (Implementation.md §20.4). */
export function registerPrompts(server: McpServer, _ctx: McpContext): void {
  server.registerPrompt(
    'plan-feature',
    {
      title: 'Plan a feature in the architecture',
      description:
        'Model a feature as a change set on top of the architecture, check it, and write the plan (tasks in build order) for implementation.',
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
                '2. Start a change set: create_change_set with a short name and the feature as the description. Use its ID as changeSetId in every step below; the baseline stays as it is.',
                '3. Find the concepts you need with get_catalog (filter by prefix, e.g. "node." or "react."); explain_concept when unsure. Add elements with upsert_elements, connect them with upsert_relations, or apply_template (with parentId to put it inside an element). Reuse existing elements; new ones get status "planned".',
                '4. validate_project with changeSetId until the change introduces no errors (findings say "introduced": true). Fix with a better design or apply_quick_fix; suppress only with a real reason. Record important choices with add_decision.',
                '5. generate_tasks, then read get_change_set: the ops, conflicts and tasks.',
                '6. export with format "plan-md", changeSetId and write: true (also "speckit" or "kiro" when the repository uses them).',
                '7. Summarize: the plan file, the new elements and relations, the data each service owns, and the findings left open and why. Implement the tasks in order; after the code is done, run archguide check and set the change set to implemented (update_change_set status "implemented").',
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
        "Draft the architecture model from the code, document it in the repository's own language, review it, and write ARCHITECTURE.md.",
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
              '   Keep the model faithful to the code, also where the code is wrong. When the code does something the rules refuse (a browser app that queries the database, a module placed where it does not belong, a store that calls a service), do not leave it out and do not draw the design it should have: add it as it is, with antiPattern: { note: what the code does, evidence: file and line } (or asFound: true on the call). It is kept, marked, and reported by rule AP-019 as something to address. Anti-patterns the rules allow but report (shared tables, cycles …) are added as they are; their findings say what to address.',
              '5. Document the blocks with write_documentation: read the repository\'s README, docs and code comments, and for every deployable, module and data store you understand write its name, description (what it is) and function (what it does), with basis "read" or "deduced" and the files as sources. Write in the language the repository\'s documentation is written in, do not translate it, and set project.lang to that language\'s BCP 47 tag (with a project summary). The editor shows these texts on the diagram as written.',
              '6. validate_project. A finding caused by a mistake in your model (a wrong kind, a missing relation): correct the model. A finding that describes what the code really does: keep it, it is an anti-pattern the team should address; do not change the model to hide it. Use suppress_finding only with a real reason (an accepted decision).',
              '7. export with format "agent-md" and write: true; generate_enforcement with write: true.',
              '8. Report what was inferred and still needs a human review (the items with source.reviewed false), the documentation language, the anti-patterns found in the code (AP-019 and the other findings) that should be addressed, and the findings left open.',
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
