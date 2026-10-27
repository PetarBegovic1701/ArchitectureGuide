// Test helpers. Not exported from the package index.
import { z } from 'zod';
import { createCatalog } from '../catalog';
import type { StackProfile } from '../catalog';
import { createProject } from '../project';
import { applyOps } from '../ops';
import type { Element, Project, Relation } from '../schema';

/** A tiny profile so core tests do not depend on a real profile package. */
export const testProfile: StackProfile = {
  id: 'test',
  name: 'Test profile',
  version: '0.0.0',
  concepts: [
    {
      id: 't.app',
      name: 'Web app',
      category: 'deployable',
      icon: 'atom',
      idPrefix: 'app',
      allowedParents: ['top', 'group.*'],
      palette: { group: 'Frontend', order: 1, basic: true },
      docs: 'Browser app.',
    },
    {
      id: 't.service',
      name: 'Service',
      category: 'deployable',
      icon: 'server',
      idPrefix: 'svc',
      allowedParents: ['top', 'group.*'],
      propertySchema: z.object({ framework: z.enum(['express', 'fastify']) }).partial(),
      palette: { group: 'Backend', order: 1, basic: true },
      docs: 'Backend service.',
    },
    {
      id: 't.module',
      name: 'Module',
      category: 'module',
      icon: 'package',
      idPrefix: 'mod',
      allowedParents: ['t.service', 't.module'],
      palette: { group: 'Backend', order: 2, basic: true },
      docs: 'Code module.',
    },
    {
      id: 't.port',
      name: 'Port',
      category: 'port',
      icon: 'circle-dot',
      idPrefix: 'port',
      allowedParents: ['t.service', 't.module'],
      palette: { group: 'Backend', order: 3, basic: true },
      docs: 'Interface.',
    },
    {
      id: 't.adapter',
      name: 'Adapter',
      category: 'adapter',
      icon: 'plug',
      idPrefix: 'ad',
      allowedParents: ['t.service', 't.module'],
      palette: { group: 'Backend', order: 4, basic: true },
      docs: 'Adapter.',
    },
    {
      id: 't.db',
      name: 'Database',
      category: 'data-at-rest',
      icon: 'database',
      idPrefix: 'db',
      allowedParents: ['top', 'group.*'],
      palette: { group: 'Data', order: 1, basic: true },
      docs: 'Database.',
    },
    {
      id: 't.event',
      name: 'Event',
      category: 'event',
      icon: 'zap',
      idPrefix: 'evt',
      allowedParents: ['top', 't.service', 't.module'],
      palette: { group: 'Events', order: 2, basic: true },
      docs: 'Event.',
    },
    {
      id: 't.domain',
      name: 'Domain',
      category: 'domain-core',
      icon: 'hexagon',
      idPrefix: 'dom',
      allowedParents: ['t.service', 't.module'],
      palette: { group: 'Backend', order: 5, basic: true },
      docs: 'Domain.',
    },
    {
      id: 't.queue',
      name: 'Queue',
      category: 'data-in-motion',
      icon: 'list-todo',
      idPrefix: 'q',
      allowedParents: ['top', 'group.*'],
      palette: { group: 'Events', order: 1, basic: true },
      docs: 'Queue.',
    },
  ],
  relationTypes: [],
  relationRules: [],
};

export const testCatalog = createCatalog([testProfile]);

export const NOW = '2026-10-27T12:00:00.000Z';

export function el(id: string, kind: string, extra: Partial<Element> = {}): Element {
  return { id, kind, name: id.split('.').pop()!, status: 'existing', ...extra };
}

export function rel(id: string, type: string, sourceId: string, targetId: string): Relation {
  return { id, type, sourceId, targetId, status: 'existing' };
}

/**
 * app.web → svc.api (calls); svc.api › mod.orders › ad.pg (writes db.main); port.repo in mod.orders.
 * View "main" shows app.web, svc.api, db.main and the two relations; one sticky note on svc.api.
 */
export function sampleProject(): Project {
  const p = createProject({ id: 'shop', name: 'Shop', profile: 'test', now: NOW });
  p.model.elements.push(
    el('app.web', 't.app'),
    el('svc.api', 't.service', { properties: { framework: 'express' } }),
    el('mod.orders', 't.module', { parentId: 'svc.api' }),
    el('port.repo', 't.port', { parentId: 'mod.orders' }),
    el('ad.pg', 't.adapter', { parentId: 'mod.orders' }),
    el('db.main', 't.db'),
  );
  p.model.relations.push(
    rel('rel.web-api', 'calls', 'app.web', 'svc.api'),
    rel('rel.pg-db', 'writes', 'ad.pg', 'db.main'),
    rel('rel.pg-port', 'implements', 'ad.pg', 'port.repo'),
  );
  const main = p.views[0]!;
  main.nodes.push(
    { elementId: 'app.web', x: 0, y: 0 },
    { elementId: 'svc.api', x: 200, y: 0 },
    { elementId: 'db.main', x: 400, y: 0 },
  );
  main.edges.push({ relationId: 'rel.web-api' }, { relationId: 'rel.pg-db' });
  main.annotations.push({
    id: 'note-1',
    kind: 'callout',
    text: 'Main entry point',
    anchor: { elementId: 'svc.api' },
    createdAt: NOW,
  });
  p.notes.push({
    id: 'glossary',
    title: 'Glossary',
    body: '',
    linkedIds: ['svc.api'],
    updatedAt: NOW,
  });
  return p;
}

type ElSpec = [id: string, kind: string, extra?: Partial<Element>];
type RelSpec = [sourceId: string, type: string, targetId: string, extra?: Partial<Relation>];

/**
 * Builds a project through real ops (so fixtures respect the hard constraints).
 * Every rule pack is on unless `packs` says otherwise.
 */
export function build(
  elements: ElSpec[],
  relations: RelSpec[] = [],
  options: { packs?: string[]; catalog?: ReturnType<typeof createCatalog> } = {},
): Project {
  const p = createProject({ id: 'fixture', name: 'Fixture', profile: 'test', now: NOW });
  p.settings.rulePacks = options.packs ?? [
    'core',
    'frontend',
    'security',
    'concurrency',
    'api',
    'event-driven',
    'microservices',
    'layered',
    'hexagonal',
    'fsd',
  ];
  const ops = [
    ...elements.map(([id, kind, extra]) => ({
      op: 'addElement' as const,
      element: el(id, kind, extra),
    })),
    ...relations.map(([s, type, t, extra], i) => ({
      op: 'addRelation' as const,
      relation: { ...rel(`rel.r${i}-${type}`, type, s, t), ...extra },
    })),
  ];
  const result = applyOps(p, ops, options.catalog ?? testCatalog);
  if (!result.ok) throw new Error(`Invalid fixture: ${JSON.stringify(result.errors[0])}`);
  return result.project;
}
