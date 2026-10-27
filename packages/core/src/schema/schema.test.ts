import { describe, expect, it } from 'vitest';
import { ElementSchema, IdSchema, OpSchema, ProjectSchema } from '.';
import { sampleProject } from '../test-support/fixtures';

describe('IdSchema', () => {
  it.each(['svc.orders', 'rel.app-web-calls-svc-api', 'adr-004', 'shop', 'store-ui.cart', 'a1.b2'])(
    'accepts %s',
    (id) => expect(IdSchema.safeParse(id).success).toBe(true),
  );
  it.each([
    '',
    'Svc.Orders',
    'svc..orders',
    '.svc',
    'svc.',
    'svc orders',
    'svc_orders',
    'x'.repeat(129),
  ])('rejects %j', (id) => expect(IdSchema.safeParse(id).success).toBe(false));
});

describe('ProjectSchema', () => {
  it('accepts the sample project', () => {
    expect(ProjectSchema.safeParse(sampleProject()).success).toBe(true);
  });

  it('drops unknown fields', () => {
    const parsed = ElementSchema.parse({
      id: 'svc.x',
      kind: 'node.service',
      name: 'X',
      status: 'existing',
      surprise: true,
    });
    expect(parsed).not.toHaveProperty('surprise');
  });

  it('rejects a wrong schema version', () => {
    expect(ProjectSchema.safeParse({ ...sampleProject(), schemaVersion: 2 }).success).toBe(false);
  });

  it('rejects an anchor that mixes element and relation', () => {
    const p = sampleProject();
    p.views[0]!.annotations[0]!.anchor = {
      elementId: 'svc.api',
      relationId: 'rel.web-api',
    } as never;
    expect(ProjectSchema.safeParse(p).success).toBe(false);
  });
});

describe('OpSchema', () => {
  it('rejects an unknown op', () => {
    expect(OpSchema.safeParse({ op: 'explode' }).success).toBe(false);
  });

  it('does not allow change-set ops inside a change set', () => {
    const changeSet = {
      id: 'cs.a',
      name: 'A',
      description: '',
      status: 'draft',
      baseRevision: 0,
      createdAt: '2026-10-27',
      ops: [{ op: 'removeChangeSet', id: 'cs.b' }],
    };
    expect(OpSchema.safeParse({ op: 'upsertChangeSet', changeSet }).success).toBe(false);
  });
});
