import { describe, expect, it } from 'vitest';
import { applyOps } from '../ops';
import type { Project, Suppression } from '../schema';
import { createCatalog } from '../catalog';
import { NOW, build, testCatalog, testProfile } from '../test-support/fixtures';
import { RULE_PACKS, activeRules, allRules, runRules } from '.';
import type { Rule } from '.';

const fire = (p: Project, ruleId: string) => runRules(p, testCatalog, { only: [ruleId] });
const targets = (p: Project, ruleId: string) => fire(p, ruleId).map((f) => f.targetIds);

describe('generic rules (AP)', () => {
  it('AP-001 shared database', () => {
    const shared = build(
      [
        ['svc.a', 't.service'],
        ['svc.b', 't.service'],
        ['db.main', 't.db'],
      ],
      [
        ['svc.a', 'writes', 'db.main'],
        ['svc.b', 'writes', 'db.main'],
      ],
    );
    expect(targets(shared, 'AP-001')).toEqual([['db.main']]);
    const owned = build(
      [
        ['svc.a', 't.service'],
        ['svc.b', 't.service'],
        ['db.main', 't.db'],
      ],
      [
        ['svc.a', 'writes', 'db.main'],
        ['svc.b', 'reads', 'db.main'],
      ],
    );
    expect(fire(owned, 'AP-001')).toEqual([]);
  });

  it('AP-002 frontend talks to a database', () => {
    const p = build(
      [
        ['app.web', 't.app'],
        ['db.main', 't.db'],
      ],
      [['app.web', 'reads', 'db.main']],
    );
    expect(fire(p, 'AP-002')).toMatchObject([{ severity: 'error' }]);
    const ok = build(
      [
        ['svc.a', 't.service'],
        ['db.main', 't.db'],
      ],
      [['svc.a', 'reads', 'db.main']],
    );
    expect(fire(ok, 'AP-002')).toEqual([]);
  });

  it('AP-003 cyclic dependency between modules', () => {
    const cyclic = build(
      [
        ['svc.a', 't.service'],
        ['mod.x', 't.module', { parentId: 'svc.a' }],
        ['mod.y', 't.module', { parentId: 'svc.a' }],
      ],
      [
        ['mod.x', 'depends-on', 'mod.y'],
        ['mod.y', 'depends-on', 'mod.x'],
      ],
    );
    expect(targets(cyclic, 'AP-003')).toEqual([['mod.x', 'mod.y']]);
    const acyclic = build(
      [
        ['svc.a', 't.service'],
        ['mod.x', 't.module', { parentId: 'svc.a' }],
        ['mod.y', 't.module', { parentId: 'svc.a' }],
      ],
      [['mod.x', 'depends-on', 'mod.y']],
    );
    expect(fire(acyclic, 'AP-003')).toEqual([]);
  });

  it('AP-004 domain depends on infrastructure', () => {
    const elements: [string, string, object?][] = [
      ['svc.a', 't.service'],
      ['dom.order', 't.domain', { parentId: 'svc.a' }],
      ['ad.pg', 't.adapter', { parentId: 'svc.a' }],
      ['port.repo', 't.port', { parentId: 'svc.a' }],
    ];
    expect(fire(build(elements, [['dom.order', 'depends-on', 'ad.pg']]), 'AP-004')).toHaveLength(1);
    expect(fire(build(elements, [['dom.order', 'uses-port', 'port.repo']]), 'AP-004')).toEqual([]);
  });

  it('AP-005 layer skipping', () => {
    const els: [string, string, object?][] = [
      ['svc.a', 't.service'],
      ['mod.ui', 't.module', { parentId: 'svc.a', layer: 'presentation' }],
      ['db.main', 't.db'],
    ];
    expect(fire(build(els, [['mod.ui', 'reads', 'db.main']]), 'AP-005')).toHaveLength(1);
    expect(fire(build(els, [['svc.a', 'reads', 'db.main']]), 'AP-005')).toEqual([]);
  });

  it('AP-006 distributed monolith (synchronous cycle between services)', () => {
    const els: [string, string][] = [
      ['svc.a', 't.service'],
      ['svc.b', 't.service'],
    ];
    expect(
      targets(
        build(els, [
          ['svc.a', 'calls', 'svc.b'],
          ['svc.b', 'calls', 'svc.a'],
        ]),
        'AP-006',
      ),
    ).toEqual([['svc.a', 'svc.b']]);
    expect(
      fire(
        build(els, [
          ['svc.a', 'calls', 'svc.b'],
          ['svc.b', 'calls', 'svc.a', { mode: 'async' }],
        ]),
        'AP-006',
      ),
    ).toEqual([]);
  });

  it('AP-007 long synchronous chain', () => {
    const chain = (n: number) =>
      build(
        [
          ['actor.user', 'gen.actor'],
          ...Array.from({ length: n }, (_, i): [string, string] => [`svc.s${i}`, 't.service']),
        ],
        [
          ['actor.user', 'calls', 'svc.s0'],
          ...Array.from({ length: n - 1 }, (_, i): [string, string, string] => [
            `svc.s${i}`,
            'calls',
            `svc.s${i + 1}`,
          ]),
        ],
      );
    expect(targets(chain(5), 'AP-007')).toEqual([['svc.s0']]);
    expect(fire(chain(4), 'AP-007')).toEqual([]);
  });

  it('AP-008 element does too much', () => {
    const many = Array.from({ length: 9 }, (_, i): [string, string] => [`db.d${i}`, 't.db']);
    const p = build(
      [['svc.a', 't.service'], ...many],
      many.map(([id]): [string, string, string] => ['svc.a', 'reads', id]),
    );
    expect(targets(p, 'AP-008')).toEqual([['svc.a']]);
    const resp = build([['svc.a', 't.service', { responsibilities: ['a', 'b', 'c'] }]]);
    expect(fire(resp, 'AP-008')).toEqual([]);
  });

  it('AP-009 frontend calls many services', () => {
    const svcs = (n: number) =>
      Array.from({ length: n }, (_, i): [string, string] => [`svc.s${i}`, 't.service']);
    const calls = (n: number) =>
      svcs(n).map(([id]): [string, string, string] => ['app.web', 'calls', id]);
    expect(targets(build([['app.web', 't.app'], ...svcs(3)], calls(3)), 'AP-009')).toEqual([
      ['app.web'],
    ]);
    expect(fire(build([['app.web', 't.app'], ...svcs(2)], calls(2)), 'AP-009')).toEqual([]);
  });

  it('AP-010 public entry without authentication', () => {
    const els: [string, string][] = [
      ['app.web', 't.app'],
      ['svc.api', 't.service'],
      ['auth.idp', 'gen.auth-provider'],
    ];
    expect(targets(build(els, [['app.web', 'calls', 'svc.api']]), 'AP-010')).toEqual([['svc.api']]);
    expect(
      fire(
        build(els, [
          ['app.web', 'calls', 'svc.api'],
          ['svc.api', 'authenticates-with', 'auth.idp'],
        ]),
        'AP-010',
      ),
    ).toEqual([]);
    expect(
      fire(
        build(els, [['app.web', 'calls', 'svc.api', { properties: { auth: 'bearer-token' } }]]),
        'AP-010',
      ),
    ).toEqual([]);
  });

  it('AP-011 queue without consumers or producers', () => {
    const els: [string, string][] = [
      ['svc.a', 't.service'],
      ['svc.b', 't.service'],
      ['q.jobs', 't.queue'],
    ];
    expect(fire(build(els, [['svc.a', 'publishes', 'q.jobs']]), 'AP-011')[0]?.message).toMatch(
      /nothing reads/,
    );
    expect(fire(build(els, [['svc.b', 'consumes', 'q.jobs']]), 'AP-011')[0]?.message).toMatch(
      /nothing writes/,
    );
    expect(
      fire(
        build(els, [
          ['svc.a', 'publishes', 'q.jobs'],
          ['svc.b', 'consumes', 'q.jobs'],
        ]),
        'AP-011',
      ),
    ).toEqual([]);
  });

  it('AP-012 no dead-letter handling, with a quick fix that resolves it', () => {
    const p = build(
      [
        ['svc.b', 't.service'],
        ['q.jobs', 't.queue'],
      ],
      [['svc.b', 'consumes', 'q.jobs']],
    );
    const [finding] = fire(p, 'AP-012');
    expect(finding?.fixes).toHaveLength(1);
    const fixed = applyOps(p, finding!.fixes[0]!.ops, testCatalog);
    if (!fixed.ok) throw new Error('fix failed');
    expect(fire(fixed.project, 'AP-012')).toEqual([]);
  });

  it('AP-013 dual write', () => {
    const els: [string, string][] = [
      ['svc.a', 't.service'],
      ['db.main', 't.db'],
      ['q.events', 't.queue'],
    ];
    expect(
      targets(
        build(els, [
          ['svc.a', 'writes', 'db.main'],
          ['svc.a', 'publishes', 'q.events'],
        ]),
        'AP-013',
      ),
    ).toEqual([['svc.a']]);
    expect(
      fire(
        build(els, [
          ['svc.a', 'writes', 'db.main'],
          ['svc.a', 'publishes', 'q.events', { inTransaction: true }],
        ]),
        'AP-013',
      ),
    ).toEqual([]);
  });

  it('AP-014 cache used as the source of truth', () => {
    const els: [string, string, object?][] = [
      ['svc.a', 't.service'],
      ['store.cache', 'gen.other-store', { properties: { kind: 'cache' } }],
      ['db.main', 't.db'],
    ];
    expect(targets(build(els, [['svc.a', 'writes', 'store.cache']]), 'AP-014')).toEqual([
      ['store.cache'],
    ]);
    expect(
      fire(
        build(els, [
          ['svc.a', 'writes', 'store.cache'],
          ['svc.a', 'writes', 'db.main'],
        ]),
        'AP-014',
      ),
    ).toEqual([]);
  });

  it('AP-015 sensitive data reachable from the browser', () => {
    const els: [string, string, object?][] = [
      ['app.web', 't.app'],
      ['svc.a', 't.service'],
      ['db.users', 't.db', { qualities: { sensitivity: 'pii' } }],
    ];
    expect(fire(build(els, [['app.web', 'reads', 'db.users']]), 'AP-015')).toMatchObject([
      { severity: 'error' },
    ]);
    expect(fire(build(els, [['svc.a', 'reads', 'db.users']]), 'AP-015')).toEqual([]);
  });

  it('AP-016 disconnected element', () => {
    expect(targets(build([['svc.a', 't.service']]), 'AP-016')).toEqual([['svc.a']]);
    const nestedConnected = build(
      [
        ['svc.a', 't.service'],
        ['mod.m', 't.module', { parentId: 'svc.a' }],
        ['db.main', 't.db'],
      ],
      [['mod.m', 'reads', 'db.main']],
    );
    expect(fire(nestedConnected, 'AP-016')).toEqual([]);
    expect(fire(build([['ctx.sales', 'group.context']]), 'AP-016')).toEqual([]);
  });

  it('AP-017 consumer calls the publisher back synchronously', () => {
    const els: [string, string][] = [
      ['svc.a', 't.service'],
      ['svc.b', 't.service'],
      ['q.events', 't.queue'],
    ];
    const base: [string, string, string][] = [
      ['svc.a', 'publishes', 'q.events'],
      ['svc.b', 'consumes', 'q.events'],
    ];
    expect(fire(build(els, [...base, ['svc.b', 'calls', 'svc.a']]), 'AP-017')).toHaveLength(1);
    expect(fire(build(els, base), 'AP-017')).toEqual([]);
  });

  it('AP-018 call without label or protocol, with a quick fix', () => {
    const els: [string, string][] = [
      ['svc.a', 't.service'],
      ['svc.b', 't.service'],
    ];
    const p = build(els, [['svc.a', 'calls', 'svc.b']]);
    const [finding] = fire(p, 'AP-018');
    const fixed = applyOps(p, finding!.fixes[0]!.ops, testCatalog);
    if (!fixed.ok) throw new Error('fix failed');
    expect(fire(fixed.project, 'AP-018')).toEqual([]);
    expect(fire(build(els, [['svc.a', 'calls', 'svc.b', { label: 'GET /x' }]]), 'AP-018')).toEqual(
      [],
    );
  });
});

describe('rule engine', () => {
  const sharedDb = () =>
    build(
      [
        ['svc.a', 't.service'],
        ['svc.b', 't.service'],
        ['db.main', 't.db'],
      ],
      [
        ['svc.a', 'writes', 'db.main'],
        ['svc.b', 'writes', 'db.main'],
      ],
      { packs: ['microservices'] },
    );

  it('every generic rule has a unique ID, a known pack and a rationale', () => {
    const rules = allRules(testCatalog);
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    const packs = new Set(RULE_PACKS.map((p) => p.id));
    for (const r of rules) {
      expect(
        r.packs.every((p) => packs.has(p)),
        r.id,
      ).toBe(true);
      expect(r.rationale.length, r.id).toBeGreaterThan(40);
    }
  });

  it('runs only rules of active packs; core is always on', () => {
    const p = sharedDb();
    p.settings.rulePacks = [];
    expect(activeRules(p, allRules(testCatalog)).map((r) => r.id)).not.toContain('AP-001');
    expect(activeRules(p, allRules(testCatalog)).map((r) => r.id)).toContain('AP-016');
    expect(runRules(sharedDb(), testCatalog).map((f) => f.ruleId)).toContain('AP-001');
  });

  it('applies overrides: off and severity', () => {
    const p = sharedDb();
    p.settings.ruleOverrides = { 'AP-001': 'error' };
    expect(runRules(p, testCatalog, { only: ['AP-001'] })[0]?.severity).toBe('error');
    p.settings.ruleOverrides = { 'AP-001': 'off' };
    expect(runRules(p, testCatalog, { only: ['AP-001'] })).toEqual([]);
  });

  it('a profile rule replaces the generic rule it names', () => {
    const better: Rule = {
      id: 'TST-001',
      title: 'Better shared DB',
      severity: 'warning',
      packs: ['microservices'],
      replaces: ['AP-001'],
      rationale: 'x'.repeat(50),
      check: () => [{ targetIds: ['db.main'], message: 'better' }],
    };
    const catalog = createCatalog([{ ...testProfile, rules: [better] }]);
    const ids = runRules(sharedDb(), catalog).map((f) => f.ruleId);
    expect(ids).toContain('TST-001');
    expect(ids).not.toContain('AP-001');
  });

  it('marks suppressed findings and keeps them', () => {
    const p = sharedDb();
    const suppression: Suppression = {
      ruleId: 'AP-001',
      targetIds: ['db.main'],
      reason: 'Legacy reporting database',
      createdAt: NOW,
    };
    p.settings.suppressions = [suppression];
    expect(runRules(p, testCatalog, { only: ['AP-001'] })[0]?.suppressed).toEqual(suppression);
  });

  it('sorts findings by severity, then rule ID', () => {
    const p = build(
      [
        ['app.web', 't.app'],
        ['db.main', 't.db'],
        ['svc.lonely', 't.service'],
      ],
      [['app.web', 'reads', 'db.main']],
    );
    const severities = runRules(p, testCatalog).map((f) => f.severity);
    expect(severities).toEqual(
      [...severities].sort(
        (a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b),
      ),
    );
    expect(severities[0]).toBe('error');
  });

  it('runs all rules on 500 elements and 1,000 relations within the budget', () => {
    const elements: [string, string][] = [];
    for (let i = 0; i < 250; i++) elements.push([`svc.s${i}`, 't.service'], [`db.d${i}`, 't.db']);
    const relations: [string, string, string, object?][] = [];
    for (let i = 0; i < 250; i++) {
      relations.push(
        [`svc.s${i}`, 'writes', `db.d${i}`],
        [`svc.s${i}`, 'reads', `db.d${(i + 1) % 250}`],
      );
      relations.push([`svc.s${i}`, 'calls', `svc.s${(i + 1) % 250}`, { protocol: 'http' }]);
      relations.push([
        `svc.s${i}`,
        'calls',
        `svc.s${(i + 7) % 250}`,
        { protocol: 'http', mode: 'async' },
      ]);
    }
    const p = build(elements, relations);
    runRules(p, testCatalog); // warm up
    const start = Date.now();
    runRules(p, testCatalog);
    const ms = Date.now() - start;
    // Budget from Implementation.md §11.3 is 100 ms; the margin absorbs slow CI machines.
    expect(ms).toBeLessThan(250);
  });
});
