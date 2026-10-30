import { describe, expect, it } from 'vitest';
import { applyOps } from '../ops';
import { runRules } from '../rules';
import { exportProject } from '../export';
import { parseProject, serializeProject } from '../serialize';
import { el, sampleProject, testCatalog } from '../test-support/fixtures';
import type { ModelOp, Project, Relation } from '../schema';
import { AS_FOUND_NOTE, markAsFound } from './asfound';

/** db.main calls app.web: a data store does not call anything, so the rules refuse it. */
const storeCalls = (extra: Partial<Relation> = {}): ModelOp => ({
  op: 'addRelation',
  relation: {
    id: 'rel.db-calls-web',
    type: 'calls',
    sourceId: 'db.main',
    targetId: 'app.web',
    status: 'existing',
    ...extra,
  },
});

const apply = (p: Project, ops: unknown[]) => {
  const r = applyOps(p, ops, testCatalog);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.project;
};

describe('anti-patterns found in the code', () => {
  it('are refused without a mark, and kept with one', () => {
    const p = sampleProject();
    expect(applyOps(p, [storeCalls()], testCatalog)).toMatchObject({
      ok: false,
      errors: [{ code: 'RELATION_NOT_ALLOWED' }],
    });
    const kept = apply(p, [
      storeCalls({ antiPattern: { note: 'The DB trigger calls the web app' } }),
    ]);
    expect(kept.model.relations.find((r) => r.id === 'rel.db-calls-web')?.antiPattern?.note).toBe(
      'The DB trigger calls the web app',
    );
    // Nesting too: a module cannot sit in a database, unless the code has it so.
    const module = el('mod.inside', 't.module', { parentId: 'db.main' });
    expect(applyOps(p, [{ op: 'addElement', element: module }], testCatalog).ok).toBe(false);
    const nested = apply(p, [
      { op: 'addElement', element: { ...module, antiPattern: { note: 'Found in db/' } } },
    ]);
    expect(nested.model.elements.find((e) => e.id === 'mod.inside')?.parentId).toBe('db.main');
  });

  it('keep their mark until the code is fixed: removing it re-checks the rules', () => {
    const p = apply(sampleProject(), [storeCalls({ antiPattern: { note: 'As found' } })]);
    expect(
      applyOps(
        p,
        [{ op: 'updateRelation', id: 'rel.db-calls-web', patch: { antiPattern: null } }],
        testCatalog,
      ),
    ).toMatchObject({ ok: false, errors: [{ code: 'RELATION_NOT_ALLOWED' }] });
  });

  it('are reported by AP-019 with what the code does and the rule it breaks', () => {
    const p = apply(sampleProject(), [
      storeCalls({ antiPattern: { note: 'The DB calls the app.' } }),
    ]);
    const finding = runRules(p, testCatalog).find((f) => f.ruleId === 'AP-019')!;
    expect(finding).toMatchObject({
      severity: 'warning',
      targetIds: ['rel.db-calls-web'],
      relatedIds: ['app.web', 'db.main'],
    });
    expect(finding.message).toMatch(/is an anti-pattern found in the code: The DB calls the app\./);
    expect(finding.message).toMatch(/A data store does not call anything/);
    expect(finding.fixes[0]!.ops).toEqual([{ op: 'removeRelation', id: 'rel.db-calls-web' }]);
    // An allowed item can be marked too: it is reported with its note only.
    const marked = apply(sampleProject(), [
      {
        op: 'updateRelation',
        id: 'rel.web-api',
        patch: { antiPattern: { note: 'Polls every 100 ms' } },
      },
    ]);
    const polled = runRules(marked, testCatalog).find((f) => f.ruleId === 'AP-019')!;
    expect(polled.message).not.toMatch(/breaks a rule/);
  });

  it('in "as found" mode, refused items are marked instead of refused', () => {
    const p = sampleProject();
    const ops: ModelOp[] = [
      { op: 'addElement', element: el('mod.inside', 't.module', { parentId: 'db.main' }) },
      storeCalls(),
      { op: 'moveElement', id: 'port.repo', parentId: 'db.main' },
      { op: 'addElement', element: el('mod.ok', 't.module', { parentId: 'svc.api' }) },
    ];
    const strict = markAsFound(p, testCatalog, ops);
    expect(strict).toEqual({ ops, marked: [] });
    const found = markAsFound(p, testCatalog, ops, { asFound: true });
    expect(found.marked).toEqual(['mod.inside', 'rel.db-calls-web', 'port.repo']);
    expect(found.ops[0]).toMatchObject({
      element: { antiPattern: { note: AS_FOUND_NOTE, violates: expect.any(String) } },
    });
    expect(found.ops[2]).toMatchObject({ op: 'updateElement', id: 'port.repo' });
    expect(found.ops[3]).toEqual(ops[2]);
    expect(found.ops[4]).toEqual(ops[3]);
    const project = apply(p, found.ops);
    expect(runRules(project, testCatalog).filter((f) => f.ruleId === 'AP-019')).toHaveLength(3);
    // A mark given without the broken rule gets it filled in.
    const filled = markAsFound(p, testCatalog, [storeCalls({ antiPattern: { note: 'x' } })]);
    expect(filled.ops[0]).toMatchObject({
      relation: { antiPattern: { note: 'x', violates: expect.stringMatching(/data store/) } },
    });
  });

  it('survive a save and an import, and are listed for agents in ARCHITECTURE.md and YAML', () => {
    const p = apply(sampleProject(), [
      storeCalls({
        antiPattern: { note: 'The DB calls the app', evidence: [{ path: 'db/fn.sql', line: 4 }] },
      }),
    ]);
    const text = serializeProject(p);
    expect(serializeProject(parseProject(text))).toBe(text);
    const md = exportProject('agent-md', p, testCatalog).files[0]!.content;
    expect(md).toContain('## Anti-patterns found in the code');
    expect(md).toContain(
      '- `rel.db-calls-web` main calls web: The DB calls the app. Breaks: A data store does not call anything',
    );
    expect(md).toContain('In db/fn.sql:4.');
    expect(exportProject('agent-md', sampleProject(), testCatalog).files[0]!.content).not.toContain(
      'Anti-patterns found',
    );
    expect(exportProject('agent-yaml', p, testCatalog).files[0]!.content).toContain(
      'antiPattern: The DB calls the app',
    );
    const onboarding = exportProject('onboarding-md', p, testCatalog).files[0]!.content;
    expect(onboarding).toContain('## Anti-patterns found in the code');
    expect(onboarding).toContain('`rel.db-calls-web` main calls web: The DB calls the app.');
  });
});
