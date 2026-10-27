import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  SHAPES,
  applyOps,
  checkNesting,
  checkRelation,
  createCatalog,
  createProject,
  shapeOf,
  validRelationTypes,
} from '@archguide/core';
import type { Element } from '@archguide/core';
import { PROFILE_ID, profile } from '.';

const catalog = createCatalog([profile]);
const types = (from: string, to: string) => validRelationTypes(catalog, from, to).map((t) => t.id);

describe('profile integrity', () => {
  it('builds a catalog without duplicate concepts, types or prefixes', () => {
    expect(catalog.concepts.size).toBeGreaterThan(40);
  });

  it('every profile concept is complete and in the right namespace', () => {
    for (const c of profile.concepts) {
      expect(c.id, c.id).toMatch(/^(react|node|pg)\./);
      expect(CATEGORIES[c.category], c.id).toBeDefined();
      expect(SHAPES[shapeOf(c)], c.id).toBeDefined();
      expect(c.docs.length, c.id).toBeGreaterThan(10);
      for (const parent of c.allowedParents) {
        if (parent === 'top' || parent.includes(':') || parent.endsWith('.*')) continue;
        expect(catalog.concepts.has(parent), `${c.id} → ${parent}`).toBe(true);
      }
    }
  });

  it('every profile relation type is allowed somewhere', () => {
    const allowed = new Set(
      catalog.allowRules.flatMap((r) => (Array.isArray(r.type) ? r.type : [r.type])),
    );
    for (const t of profile.relationTypes) expect(allowed.has(t.id), t.id).toBe(true);
  });

  it('property schemas accept valid values and refuse wrong ones', () => {
    const schema = catalog.concepts.get('node.service')!.propertySchema!;
    expect(schema.safeParse({ framework: 'nestjs', transport: ['rest', 'trpc'] }).success).toBe(
      true,
    );
    expect(schema.safeParse({ framework: 'rails' }).success).toBe(false);
  });
});

/** Implementation.md §10.4, row by row. */
describe('hard constraints (§10.4)', () => {
  const refused = (type: string, from: string, to: string) => {
    const check = checkRelation(catalog, type, from, to);
    if (check.ok) throw new Error(`${from} ${type} ${to} should be refused`);
    return check;
  };

  it('data store calls anything → flip to reads', () => {
    expect(refused('calls', 'gen.other-store', 'node.service')).toMatchObject({
      message: expect.stringMatching(/data store does not call/),
      flip: 'reads',
    });
  });

  it('queue calls worker → flip to processes', () => {
    expect(refused('calls', 'pg.job-queue', 'node.worker')).toMatchObject({ flip: 'processes' });
    expect(refused('calls', 'gen.other-broker', 'node.worker')).toMatchObject({
      message: expect.stringMatching(/Queues do not call/),
      flip: 'consumes',
    });
  });

  it('port implements adapter → flip', () => {
    expect(refused('implements', 'node.port', 'node.repository')).toMatchObject({
      message: expect.stringMatching(/Reversed/),
      flip: 'implements',
    });
  });

  it('domain object reads a database → use a repository', () => {
    expect(refused('reads', 'node.domain', 'pg.schema').message).toMatch(/no I\/O/);
  });

  it('events have no outgoing relations', () => {
    expect(refused('calls', 'node.event', 'node.service').message).toMatch(/Events are facts/);
    expect(types('node.event', 'node.service')).toEqual([]);
  });

  it.each(['pg.database', 'pg.schema', 'pg.table', 'pg.pooler', 'pg.job-queue'])(
    'React code cannot reach %s',
    (target) => {
      for (const from of ['react.app', 'react.route', 'react.api-client', 'react.hook']) {
        expect(types(from, target), `${from} → ${target}`).toEqual([]);
      }
      expect(refused('reads', 'react.app', target).message).toMatch(
        /Browser code cannot connect to PostgreSQL/,
      );
    },
  );

  it('PostgreSQL does not call services → flip to reads', () => {
    expect(refused('calls', 'pg.schema', 'node.service')).toMatchObject({
      message: expect.stringMatching(/PostgreSQL does not call/),
      flip: 'reads',
    });
  });

  it('writes to a replica or a view are refused, reads are fine', () => {
    expect(refused('writes', 'node.service', 'pg.replica').message).toMatch(
      /Replicas are read-only/,
    );
    expect(refused('writes', 'node.repository', 'pg.view').message).toMatch(/Views are read-only/);
    expect(types('node.service', 'pg.replica')).toEqual(['reads']);
  });

  it('only Node workers and services process jobs', () => {
    expect(refused('processes', 'gen.external', 'pg.job-queue').message).toMatch(
      /Only Node workers or services/,
    );
    expect(types('node.worker', 'pg.job-queue')).toEqual(['processes', 'enqueues']);
  });

  it('migrations run from backend code', () => {
    expect(refused('migrates', 'react.app', 'pg.schema').message).toMatch(
      /Migrations run from backend code/,
    );
  });

  it('a server cannot call browser code', () => {
    expect(refused('calls', 'node.service', 'react.app').message).toMatch(
      /server cannot call browser code/,
    );
  });

  it('job queues and channels use their own relation types', () => {
    expect(refused('publishes', 'node.service', 'pg.job-queue').message).toMatch(/Use "enqueues"/);
    expect(refused('consumes', 'node.worker', 'pg.channel').message).toMatch(
      /notifies" or "listens/,
    );
  });

  it('pg.table outside a schema, React app inside a service, and schemas outside a database are refused', () => {
    expect(checkNesting(catalog, 'pg.table', null)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/schema/),
    });
    expect(checkNesting(catalog, 'pg.table', 'pg.database').ok).toBe(false);
    expect(checkNesting(catalog, 'react.app', 'node.service')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/serves/),
    });
    expect(checkNesting(catalog, 'pg.schema', null).ok).toBe(false);
  });
});

describe('smart defaults (§10.5)', () => {
  it.each([
    ['react.app', 'node.service', ['calls']],
    ['react.api-client', 'node.bff', ['calls']],
    ['node.service', 'pg.schema', ['reads', 'writes', 'migrates']],
    ['node.repository', 'pg.schema', ['reads', 'writes']],
    ['node.service', 'pg.job-queue', ['enqueues', 'processes']],
    ['node.service', 'pg.pooler', ['connects-via']],
    ['pg.pooler', 'pg.database', ['connects-via']],
    ['pg.database', 'pg.replica', ['replicates-to']],
    ['node.service', 'react.app', ['serves']],
    ['node.repository', 'node.port', ['implements', 'depends-on']],
    ['node.use-case', 'node.port', ['depends-on', 'uses-port']],
    ['react.route', 'react.server-state', ['uses-state']],
    ['react.server-state', 'react.api-client', ['fetches-via']],
    ['node.ws-gateway', 'pg.channel', ['listens']],
    ['node.service', 'gen.external', ['calls', 'authenticates-with']],
    ['gen.actor', 'react.app', ['calls']],
  ])('%s → %s offers %j', (from, to, expected) => {
    expect(types(from, to)).toEqual(expected);
  });
});

describe('nesting', () => {
  it.each([
    ['react.route', 'react.app'],
    ['react.route', 'react.layout'],
    ['node.module', 'node.service'],
    ['node.route-handler', 'node.module'],
    ['node.use-case', 'group.layer'],
    ['node.domain', 'group.context'],
    ['pg.database', 'pg.cluster'],
    ['pg.schema', 'pg.database'],
    ['pg.table', 'pg.schema'],
    ['pg.job-queue', 'pg.schema'],
    ['node.service', 'group.context'],
  ])('%s may sit inside %s', (child, parent) => {
    expect(checkNesting(catalog, child, parent).ok).toBe(true);
  });

  it.each([
    ['node.service', 'pg.cluster'],
    ['node.module', 'react.app'],
    ['react.feature', 'node.service'],
    ['pg.schema', 'node.service'],
  ])('%s may not sit inside %s', (child, parent) => {
    expect(checkNesting(catalog, child, parent).ok).toBe(false);
  });
});

describe('end to end with ops', () => {
  it('builds the starter architecture (T1 shape) and refuses a browser → database shortcut', () => {
    const now = '2026-10-27T12:00:00.000Z';
    const p = createProject({ id: 'shop', name: 'Shop', profile: PROFILE_ID, now });
    const e = (id: string, kind: string, extra: Partial<Element> = {}): Element => ({
      id,
      kind,
      name: id,
      status: 'existing',
      ...extra,
    });
    const r = (id: string, type: string, sourceId: string, targetId: string) => ({
      op: 'addRelation' as const,
      relation: { id, type, sourceId, targetId, status: 'existing' as const },
    });
    const result = applyOps(
      p,
      [
        { op: 'addElement', element: e('actor.customer', 'gen.actor') },
        {
          op: 'addElement',
          element: e('app.web', 'react.app', { properties: { bundler: 'vite' } }),
        },
        {
          op: 'addElement',
          element: e('route.home', 'react.route', {
            parentId: 'app.web',
            properties: { path: '/' },
          }),
        },
        {
          op: 'addElement',
          element: e('svc.api', 'node.service', { properties: { framework: 'express' } }),
        },
        { op: 'addElement', element: e('db.shop', 'pg.database') },
        { op: 'addElement', element: e('schema.public', 'pg.schema', { parentId: 'db.shop' }) },
        r('rel.customer-web', 'calls', 'actor.customer', 'app.web'),
        r('rel.web-api', 'calls', 'app.web', 'svc.api'),
        r('rel.api-reads', 'reads', 'svc.api', 'schema.public'),
        r('rel.api-writes', 'writes', 'svc.api', 'schema.public'),
        r('rel.api-migrates', 'migrates', 'svc.api', 'schema.public'),
      ],
      catalog,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const shortcut = applyOps(
      result.project,
      [r('rel.web-db', 'reads', 'app.web', 'schema.public')],
      catalog,
    );
    expect(shortcut).toMatchObject({
      ok: false,
      errors: [{ code: 'RELATION_NOT_ALLOWED', message: expect.stringMatching(/Browser code/) }],
    });
  });
});

describe('learning concepts: APIs, data shapes, stored functions, triggers', () => {
  it.each([
    ['react.api-client', 'node.endpoint', ['calls']],
    ['node.endpoint', 'node.use-case', ['calls', 'depends-on']],
    ['node.endpoint', 'node.dto', ['depends-on']],
    ['node.dto', 'node.dto', ['depends-on']],
    ['react.feature', 'node.dto', ['depends-on']],
    ['node.repository', 'pg.function', ['invokes']],
    ['node.endpoint', 'pg.function', ['invokes']],
    ['pg.function', 'pg.function', ['invokes']],
    ['pg.trigger', 'pg.function', ['invokes']],
    ['pg.trigger', 'pg.table', ['fires-on', 'reads', 'writes']],
    ['pg.function', 'pg.table', ['reads', 'writes']],
    ['pg.function', 'pg.channel', ['notifies']],
    ['pg.function', 'pg.job-queue', ['enqueues']],
  ])('%s → %s offers %j', (from, to, expected) => {
    expect(types(from, to)).toEqual(expected);
  });

  it('runs database functions with invokes, never calls', () => {
    const check = checkRelation(catalog, 'calls', 'node.service', 'pg.function');
    expect(check).toMatchObject({ ok: false, alternatives: ['invokes'] });
    if (!check.ok) expect(check.message).toMatch(/invokes/);
  });

  it('keeps database code inside the database', () => {
    for (const to of ['node.service', 'react.app', 'gen.external', 'gen.other-store']) {
      expect(types('pg.function', to), to).toEqual([]);
    }
    expect(types('react.app', 'pg.function')).toEqual([]);
    expect(types('pg.function', 'pg.view')).toEqual(['reads']);
  });

  it('only React renders, and browser code does not import server code', () => {
    expect(types('node.module', 'node.module')).toEqual(['calls', 'depends-on']);
    expect(types('react.route', 'react.component')).toEqual(['renders']);
    expect(types('react.route', 'react.route')).toEqual(['renders', 'navigates']);
    const check = checkRelation(catalog, 'depends-on', 'react.feature', 'node.use-case');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toMatch(/must not import server code/);
    expect(types('react.feature', 'node.contract')).toEqual(['depends-on', 'uses-port']);
  });

  it('data shapes have no behaviour', () => {
    for (const to of ['node.service', 'pg.table', 'node.use-case'])
      expect(types('node.dto', to), to).toEqual([]);
  });

  it('validates endpoint, scaling and relation properties', () => {
    const endpoint = catalog.concepts.get('node.endpoint')!.propertySchema!;
    expect(
      endpoint.safeParse({ method: 'POST', path: '/orders', statusCodes: [201, 409] }).success,
    ).toBe(true);
    expect(endpoint.safeParse({ method: 'FETCH' }).success).toBe(false);
    expect(endpoint.safeParse({ path: 'orders' }).success).toBe(false);
    const service = catalog.concepts.get('node.service')!.propertySchema!;
    expect(service.safeParse({ instances: 3, processModel: 'cluster', poolSize: 10 }).success).toBe(
      true,
    );
    const writes = catalog.relationTypes.get('writes')!.propertySchema!;
    expect(
      writes.safeParse({ concurrencyControl: 'row-lock', isolation: 'serializable' }).success,
    ).toBe(true);
    expect(writes.safeParse({ concurrencyControl: 'hope' }).success).toBe(false);
  });

  it('nests endpoints, data shapes, functions and triggers in the right places', () => {
    expect(checkNesting(catalog, 'node.endpoint', 'node.route-handler').ok).toBe(true);
    expect(checkNesting(catalog, 'node.endpoint', 'node.contract').ok).toBe(true);
    expect(checkNesting(catalog, 'node.endpoint', 'node.service').ok).toBe(false);
    expect(checkNesting(catalog, 'node.dto', 'node.contract').ok).toBe(true);
    expect(checkNesting(catalog, 'pg.function', 'pg.schema').ok).toBe(true);
    expect(checkNesting(catalog, 'pg.function', 'pg.database').ok).toBe(false);
    expect(checkNesting(catalog, 'pg.trigger', null).ok).toBe(false);
  });
});

describe('layered calls', () => {
  it('a use case calls a repository directly (layered) or through a port (hexagonal)', () => {
    expect(types('node.use-case', 'node.repository')).toEqual(['calls', 'depends-on']);
    expect(types('node.use-case', 'node.port')).toEqual(['depends-on', 'uses-port']);
    expect(types('react.feature', 'react.api-client')).toEqual([
      'calls',
      'depends-on',
      'fetches-via',
    ]);
  });
});
