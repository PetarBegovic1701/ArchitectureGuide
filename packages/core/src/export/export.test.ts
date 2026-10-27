import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { NOW, build, sampleProject, testCatalog } from '../test-support/fixtures';
import { draftTour } from '../tours';
import { TourSchema } from '../schema';
import { exportProject, glossary, neighborhood } from '.';

const md = (p = sampleProject(), options = {}) =>
  exportProject('agent-md', p, testCatalog, options).files[0]!.content;

describe('agent-md', () => {
  it('has front matter, tables and only non-empty sections', () => {
    const text = md();
    expect(text.startsWith('---\narchguide: 1\nproject: shop\nprofile: test\n')).toBe(true);
    expect(text).toContain('# Architecture: Shop');
    expect(text).toContain(
      '| ID | Kind | Name | Parent | Layer | Tech | Responsibilities | Code |',
    );
    expect(text).toContain('| app.web | calls | svc.api | – |');
    expect(text).not.toContain('## Decisions');
    expect(text).not.toContain('\n\n\n');
  });

  it('escapes table cells and keeps notes, comments, decisions and the glossary', () => {
    const p = sampleProject();
    p.model.elements.find((e) => e.id === 'svc.api')!.responsibilities = [
      'Read | write',
      'Line\nbreak',
    ];
    p.model.elements.find((e) => e.id === 'svc.api')!.notes = 'Owned by team A. See @db.main.';
    p.notes.find((n) => n.id === 'glossary')!.body =
      '- **Order**: a confirmed cart\nCart: an order in progress';
    p.notes.push({
      id: 'n-2',
      title: 'Release plan',
      body: 'Ship in Q3.',
      linkedIds: [],
      updatedAt: NOW,
    });
    p.views[0]!.annotations.push(
      {
        id: 'c-1',
        kind: 'comment',
        text: 'Why REST here?',
        anchor: { elementId: 'app.web' },
        createdAt: NOW,
        replies: [{ text: 'Simplest option.', createdAt: NOW }],
      },
      {
        id: 'c-2',
        kind: 'comment',
        text: 'Done already',
        anchor: { elementId: 'app.web' },
        createdAt: NOW,
        resolved: true,
      },
    );
    p.decisions.push({
      id: 'adr-001',
      title: 'Use REST',
      status: 'accepted',
      context: '',
      decision: 'REST between web and API.',
      consequences: '',
      linkedIds: ['app.web', 'svc.api'],
      date: NOW,
    });
    const text = md(p);
    expect(text).toContain('Read \\| write; Line break');
    expect(text).toContain(
      '## Glossary\n\n- **Order**: a confirmed cart\n- **Cart**: an order in progress',
    );
    expect(text).toContain('### Release plan\n\nShip in Q3.');
    expect(text).toContain('- `svc.api`: Owned by team A. See @db.main.');
    expect(text).toContain('- On `app.web`: Why REST here? / Simplest option.');
    expect(text).not.toContain('Done already');
    expect(text).toContain(
      '- **adr-001** (accepted): Use REST. REST between web and API. Links: app.web, svc.api.',
    );
    expect(md(p, { includeNotes: false })).not.toContain('Release plan');
  });

  it('lists open problems and suppressed findings as known issues', () => {
    const p = build(
      [
        ['app.web', 't.app'],
        ['db.main', 't.db'],
      ],
      [['app.web', 'reads', 'db.main']],
    );
    expect(md(p)).toMatch(/\| AP-002 Frontend talks to a database \| rel\.r0-reads \| open \|/);
  });

  it('exports a neighborhood around a focus element', () => {
    const p = sampleProject();
    expect([...neighborhood(p, testCatalog, 'app.web', 1)].sort()).toEqual(
      ['ad.pg', 'app.web', 'mod.orders', 'port.repo', 'svc.api']
        .filter((id) => id !== 'ad.pg' && id !== 'mod.orders' && id !== 'port.repo')
        .concat([])
        .sort(),
    );
    const text = md(p, { focus: 'app.web' });
    expect(text).toContain('neighborhood of `app.web`');
    expect(text).not.toContain('| db.main |');
    expect(exportProject('agent-md', p, testCatalog, { focus: 'app.web' }).files[0]!.path).toBe(
      'ARCHITECTURE.app.web.md',
    );
  });
});

describe('other formats', () => {
  it('agent-yaml parses, with relations as tuples', () => {
    const data = parse(exportProject('agent-yaml', sampleProject(), testCatalog).files[0]!.content);
    expect(data.project).toBe('shop');
    expect(data.relations).toContainEqual(['app.web', 'calls', 'svc.api']);
    expect(data.elements.find((e: { id: string }) => e.id === 'mod.orders').parent).toBe('svc.api');
  });

  it('mermaid nests containers and uses safe IDs', () => {
    const text = exportProject('mermaid', sampleProject(), testCatalog).files[0]!.content;
    expect(text.startsWith('flowchart LR\n')).toBe(true);
    expect(text).toContain('subgraph svc__api["api"]');
    expect(text).toContain('app__web -->|"calls"| svc__api');
    expect(text).toContain('ad__pg ==>|"writes"| db__main');
  });

  it('json round-trips', () => {
    const p = sampleProject();
    const file = exportProject('json', p, testCatalog).files[0]!;
    expect(file.path).toBe('shop.archguide.json');
    expect(JSON.parse(file.content).model.elements).toHaveLength(p.model.elements.length);
  });
});

describe('glossary', () => {
  it('reads term: definition lines, with or without list markers', () => {
    const p = sampleProject();
    p.notes[0]!.body = 'Order: a confirmed cart\n* **SKU**: stock keeping unit\nnot a term';
    expect(glossary(p)).toEqual([
      { term: 'Order', definition: 'a confirmed cart' },
      { term: 'SKU', definition: 'stock keeping unit' },
    ]);
  });
});

describe('draftTour', () => {
  it('walks from the actors through the services to the data', () => {
    const p = build(
      [
        ['actor.user', 'gen.actor'],
        ['app.web', 't.app'],
        ['svc.api', 't.service', { responsibilities: ['Take orders'] }],
        ['mod.orders', 't.module', { parentId: 'svc.api' }],
        ['db.main', 't.db'],
        ['q.jobs', 't.queue'],
        ['svc.worker', 't.service'],
      ],
      [
        ['actor.user', 'calls', 'app.web'],
        ['app.web', 'calls', 'svc.api'],
        ['mod.orders', 'writes', 'db.main'],
        ['mod.orders', 'publishes', 'q.jobs'],
        ['svc.worker', 'consumes', 'q.jobs'],
      ],
    );
    const tour = draftTour(p, testCatalog);
    expect(TourSchema.safeParse(tour).success).toBe(true);
    expect(tour.steps.map((s) => s.title)).toEqual([
      'Who uses it',
      'web',
      'api',
      'worker',
      'The data',
      'Work in the background',
    ]);
    expect(tour.steps[2]!.body).toContain('It is responsible for: Take orders.');
    expect(tour.steps[2]!.elementIds).toEqual(['svc.api', 'mod.orders']);
  });

  it('works on an empty project', () => {
    const tour = draftTour(build([]), testCatalog);
    expect(tour.steps).toHaveLength(1);
  });
});
