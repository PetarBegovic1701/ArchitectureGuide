import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalize, parseProject, serializeProject } from '.';
import { MigrationError } from '../migrate';
import { sampleProject } from '../test-support/fixtures';
import type { Project } from '../schema';

function shuffleKeys<T>(value: T, rand: () => number): T {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rand)) as T;
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value).sort(() => rand() - 0.5);
  return Object.fromEntries(entries.map(([k, v]) => [k, shuffleKeys(v, rand)])) as T;
}

describe('serializeProject', () => {
  it('round-trips: serialize(parse(serialize(p))) === serialize(p)', () => {
    const text = serializeProject(sampleProject());
    expect(serializeProject(parseProject(text))).toBe(text);
  });

  it('ends with exactly one newline and uses 2-space indentation', () => {
    const text = serializeProject(sampleProject());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text.split('\n')[1]).toMatch(/^ {2}"schemaVersion": 1,$/);
  });

  it('writes keys in schema order, not input order', () => {
    const text = serializeProject(sampleProject());
    const keys = Object.keys(JSON.parse(text));
    expect(keys.slice(0, 4)).toEqual(['schemaVersion', 'revision', 'id', 'name']);
  });

  it('gives the same bytes for any key order and item order', () => {
    const expected = serializeProject(sampleProject());
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        let s = seed;
        const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 + 1) % 1;
        const p = shuffleKeys(sampleProject(), rand);
        p.model.elements.reverse();
        p.model.relations.reverse();
        p.views[0]!.nodes.reverse();
        expect(serializeProject(p)).toBe(expected);
      }),
      { numRuns: 50 },
    );
  });

  it('leaves out empty optional fields', () => {
    const p = sampleProject();
    p.model.elements[0] = { ...p.model.elements[0]!, tags: [], properties: {}, codePaths: [] };
    const out = canonicalize(p).model.elements.find((e) => e.id === 'app.web')!;
    expect(out).not.toHaveProperty('tags');
    expect(out).not.toHaveProperty('properties');
    expect(out).not.toHaveProperty('codePaths');
  });

  it('keeps required empty arrays', () => {
    const json = JSON.parse(serializeProject(sampleProject())) as Project;
    expect(json.decisions).toEqual([]);
    expect(json.changeSets).toEqual([]);
  });

  it('does not change the input', () => {
    const p = sampleProject();
    p.model.elements.reverse();
    const before = JSON.stringify(p);
    serializeProject(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('parseProject', () => {
  it('rejects a newer schema version with a clear message', () => {
    expect(() => parseProject({ ...sampleProject(), schemaVersion: 99 })).toThrow(MigrationError);
    expect(() => parseProject({ ...sampleProject(), schemaVersion: 99 })).toThrow(
      /Update ArchitectureGuide/,
    );
  });

  it('rejects input without a schema version', () => {
    expect(() => parseProject('{}')).toThrow(/schemaVersion/);
    expect(() => parseProject('[]')).toThrow(MigrationError);
  });
});
