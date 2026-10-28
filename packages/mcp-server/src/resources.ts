import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { allRules, allTemplates, catalogSummary, exportProject } from '@archguide/core';
import type { McpContext } from './context';
import { readProject } from './context';

const json = (uri: URL, value: unknown): ReadResourceResult => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
});

const text = (uri: URL, value: string, mimeType: string): ReadResourceResult => ({
  contents: [{ uri: uri.href, mimeType, text: value }],
});

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0]! : (v ?? ''));

/** Read-only views of the workspace and the catalog (Implementation.md §20.3). */
export function registerResources(server: McpServer, ctx: McpContext): void {
  const { catalog, workspace: ws } = ctx;

  server.registerResource(
    'projects',
    'archguide://projects',
    { title: 'Projects', description: 'Projects in the workspace.', mimeType: 'application/json' },
    async (uri) => json(uri, await ws.listProjects()),
  );

  const projectList = async () => ({
    resources: (await ws.listProjects()).map((p) => ({
      uri: `archguide://projects/${p.id}`,
      name: p.name,
      mimeType: 'text/markdown',
    })),
  });

  server.registerResource(
    'project',
    new ResourceTemplate('archguide://projects/{id}', { list: projectList }),
    {
      title: 'Project',
      description: 'The architecture as agent Markdown (ARCHITECTURE.md).',
      mimeType: 'text/markdown',
    },
    async (uri, { id }) =>
      text(
        uri,
        exportProject('agent-md', await readProject(ctx, one(id)), catalog).files[0]!.content,
        'text/markdown',
      ),
  );

  server.registerResource(
    'project-yaml',
    new ResourceTemplate('archguide://projects/{id}/yaml', { list: undefined }),
    {
      title: 'Project (agent YAML)',
      description: 'The model as compact YAML for agents.',
      mimeType: 'application/yaml',
    },
    async (uri, { id }) =>
      text(
        uri,
        exportProject('agent-yaml', await readProject(ctx, one(id)), catalog).files[0]!.content,
        'application/yaml',
      ),
  );

  server.registerResource(
    'change-set',
    new ResourceTemplate('archguide://projects/{id}/change-sets/{csId}', {
      list: async () => {
        const out: { uri: string; name: string; mimeType: string }[] = [];
        for (const entry of await ws.listProjects()) {
          const p = await readProject(ctx, entry.id);
          for (const c of p.changeSets)
            if (c.status === 'draft' || c.status === 'ready')
              out.push({
                uri: `archguide://projects/${p.id}/change-sets/${c.id}`,
                name: `${p.name}: ${c.name}`,
                mimeType: 'text/markdown',
              });
        }
        return { resources: out };
      },
    }),
    {
      title: 'Change-set plan',
      description: 'The plan of a change set (plan-md): changes, invariants, rule check, tasks.',
      mimeType: 'text/markdown',
    },
    async (uri, { id, csId }) =>
      text(
        uri,
        exportProject('plan-md', await readProject(ctx, one(id)), catalog, {
          changeSetId: one(csId),
        }).files[0]!.content,
        'text/markdown',
      ),
  );

  server.registerResource(
    'catalog',
    'archguide://catalog',
    {
      title: 'Catalog',
      description: 'All concepts and relation types.',
      mimeType: 'application/json',
    },
    async (uri) => json(uri, catalogSummary(catalog)),
  );

  server.registerResource(
    'catalog-filter',
    new ResourceTemplate('archguide://catalog/{kindPrefix}', { list: undefined }),
    {
      title: 'Catalog (filtered)',
      description: 'Concepts whose ID starts with the prefix, and how they connect.',
      mimeType: 'application/json',
    },
    async (uri, { kindPrefix }) => json(uri, catalogSummary(catalog, one(kindPrefix))),
  );

  const rules = () =>
    allRules(catalog).map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      packs: r.packs,
      ...(r.learnId ? { learnId: r.learnId } : {}),
    }));

  server.registerResource(
    'rules',
    'archguide://rules',
    { title: 'Rules', description: 'The architecture rules.', mimeType: 'application/json' },
    async (uri) => json(uri, rules()),
  );

  server.registerResource(
    'rule',
    new ResourceTemplate('archguide://rules/{ruleId}', {
      list: async () => ({
        resources: rules().map((r) => ({
          uri: `archguide://rules/${r.id}`,
          name: `${r.id} ${r.title}`,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'Rule',
      description: 'Why a rule exists and what to do instead.',
      mimeType: 'text/markdown',
    },
    async (uri, { ruleId }) => {
      const rule = allRules(catalog).find((r) => r.id === one(ruleId));
      if (!rule) throw new Error(`Unknown rule "${one(ruleId)}".`);
      return text(
        uri,
        `# ${rule.id} ${rule.title}\n\nSeverity: ${rule.severity}\n\n${rule.rationale.trim()}\n`,
        'text/markdown',
      );
    },
  );

  server.registerResource(
    'template',
    new ResourceTemplate('archguide://templates/{id}', {
      list: async () => ({
        resources: allTemplates(catalog).map((t) => ({
          uri: `archguide://templates/${t.id}`,
          name: t.name,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Template',
      description: 'An architecture template with its parameters and parts.',
      mimeType: 'application/json',
    },
    async (uri, { id }) => {
      const template = allTemplates(catalog).find((t) => t.id === one(id) || t.code === one(id));
      if (!template) throw new Error(`Unknown template "${one(id)}".`);
      return json(uri, template);
    },
  );
}
