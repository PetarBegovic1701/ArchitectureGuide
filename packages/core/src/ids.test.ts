import { describe, expect, it } from 'vitest';
import { makeElementId, makeRelationId, slugify, uniqueId } from './ids';
import { IdSchema } from './schema';

describe('slugify', () => {
  it.each([
    ['Orders', 'orders'],
    ['Orders API (v2)', 'orders-api-v2'],
    ['  Café  Crème ', 'cafe-creme'],
    ['PgOrderRepository', 'pgorderrepository'],
    ['---', 'item'],
    ['', 'item'],
    ['日本', 'item'],
  ])('%j → %j', (input, expected) => expect(slugify(input)).toBe(expected));

  it('limits the length and never ends with a dash', () => {
    const slug = slugify(`${'a'.repeat(59)} b`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('IDs', () => {
  it('adds a numeric suffix on collision', () => {
    expect(uniqueId('svc.orders', new Set(['svc.orders', 'svc.orders-2']))).toBe('svc.orders-3');
  });

  it('builds valid element and relation IDs', () => {
    const elementId = makeElementId('svc', 'Orders API', new Set());
    expect(elementId).toBe('svc.orders-api');
    const relationId = makeRelationId('app.web', 'calls', 'svc.orders-api', new Set());
    expect(relationId).toBe('rel.app-web-calls-svc-orders-api');
    expect(IdSchema.safeParse(elementId).success).toBe(true);
    expect(IdSchema.safeParse(relationId).success).toBe(true);
  });
});
