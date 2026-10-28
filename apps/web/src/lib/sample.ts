import { applyOps, createProject } from '@archguide/core';
import type { Op, Project } from '@archguide/core';
import { DEFAULT_PROFILE, catalog } from './catalog';

/** A small starter: customer → React app → Node API → Postgres (the T1 shape, §12.2). */
export function sampleProject(id: string, now = new Date().toISOString()): Project {
  const base = createProject({
    id,
    name: 'Starter: React + Node.js + PostgreSQL',
    description: 'A React app calls a Node.js API, which owns a PostgreSQL schema.',
    profile: DEFAULT_PROFILE,
    now,
  });
  const el = (
    id: string,
    kind: string,
    name: string,
    x: number,
    y: number,
    extra: object = {},
  ): Op[] => [
    { op: 'addElement', element: { id, kind, name, status: 'planned', ...extra } },
    { op: 'setViewNode', viewId: 'main', node: { elementId: id, x, y } },
  ];
  const rel = (
    id: string,
    type: string,
    sourceId: string,
    targetId: string,
    extra: object = {},
  ): Op[] => [
    { op: 'addRelation', relation: { id, type, sourceId, targetId, status: 'planned', ...extra } },
    { op: 'setViewEdge', viewId: 'main', edge: { relationId: id } },
  ];
  const ops: Op[] = [
    ...el('actor.customer', 'gen.actor', 'Customer', 40, 80),
    ...el('app.web', 'react.app', 'Web', 200, 72, {
      layer: 'presentation',
      properties: { bundler: 'vite' },
    }),
    ...el('svc.api', 'node.service', 'API', 440, 72, {
      layer: 'application',
      properties: { framework: 'express' },
    }),
    ...el('db.shop', 'pg.database', 'Shop DB', 680, 24, { layer: 'data' }),
    ...el('schema.public', 'pg.schema', 'public', 16, 40, { parentId: 'db.shop', layer: 'data' }),
    ...rel('rel.customer-uses-web', 'calls', 'actor.customer', 'app.web'),
    ...rel('rel.web-calls-api', 'calls', 'app.web', 'svc.api', { protocol: 'http' }),
    ...rel('rel.api-reads-public', 'reads', 'svc.api', 'schema.public', { via: 'prisma' }),
    ...rel('rel.api-writes-public', 'writes', 'svc.api', 'schema.public', { via: 'prisma' }),
    ...rel('rel.api-migrates-public', 'migrates', 'svc.api', 'schema.public'),
    {
      op: 'upsertTour',
      tour: {
        id: 'tour.starter',
        title: 'How a request travels',
        audience: 'beginner',
        steps: [
          {
            id: 'step.web',
            title: 'The React app',
            body: 'The customer uses @app.web, a React app that runs in the browser. It shows data and sends requests; it never talks to the database.',
            elementIds: ['actor.customer', 'app.web'],
            relationIds: ['rel.customer-uses-web'],
            conceptIds: ['react.app'],
          },
          {
            id: 'step.api',
            title: 'The API',
            body: '@app.web calls @svc.api over HTTP. The API checks the request, runs the business logic and decides what to read or write.',
            elementIds: ['app.web', 'svc.api'],
            relationIds: ['rel.web-calls-api'],
            conceptIds: ['node.service', 'calls'],
          },
          {
            id: 'step.data',
            title: 'The data',
            body: 'Only @svc.api reads and writes the @schema.public schema, and it owns the migrations. One owner per schema keeps the data consistent.',
            elementIds: ['svc.api', 'schema.public'],
            relationIds: [
              'rel.api-reads-public',
              'rel.api-writes-public',
              'rel.api-migrates-public',
            ],
            conceptIds: ['pg.schema', 'migrates'],
          },
        ],
      },
    },
  ];
  const result = applyOps(base, ops, catalog);
  if (!result.ok) throw new Error(`Sample project is invalid: ${result.errors[0]?.message}`);
  return result.project;
}
