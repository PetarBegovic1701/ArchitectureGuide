import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { NOW, sampleProject, testCatalog } from '../test-support/fixtures';
import { applyOps } from '../ops';
import { parseProject, serializeProject } from '../serialize';
import { exportProject } from '../export';
import type { Project } from '../schema';
import { displayName, docsLang, documentationOps, hasDocs, textDirection } from '.';

/** Documentation written the way an agent writes it through MCP: in Serbian. */
function documented(): Project {
  const p = sampleProject();
  const { ops, errors } = documentationOps(
    p,
    {
      project: { lang: 'sr-Latn', summary: 'Prodavnica: porudžbine i plaćanja.', author: 'agent' },
      elements: [
        {
          id: 'svc.api',
          name: 'Servis porudžbina',
          description: 'Backend koji prima porudžbine.',
          function: 'Proverava korpu i čuva porudžbinu.',
          basis: 'read',
          sources: ['services/api/README.md'],
        },
        { id: 'db.main', description: 'מסד הנתונים הראשי', lang: 'he', basis: 'deduced' },
      ],
    },
    NOW,
  );
  expect(errors).toEqual([]);
  const r = applyOps(p, ops, testCatalog);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.project;
}

describe('repository documentation', () => {
  it('stores the texts as written, with the language and where they came from', () => {
    const p = documented();
    const api = p.model.elements.find((e) => e.id === 'svc.api')!;
    expect(p.docs).toEqual({
      lang: 'sr-Latn',
      summary: 'Prodavnica: porudžbine i plaćanja.',
      author: 'agent',
      updatedAt: NOW,
    });
    expect(api.docs).toEqual({
      name: 'Servis porudžbina',
      description: 'Backend koji prima porudžbine.',
      function: 'Proverava korpu i čuva porudžbinu.',
      basis: 'read',
      sources: ['services/api/README.md'],
    });
    expect(api.name).toBe('api');
    expect(displayName(api)).toBe('Servis porudžbina');
    expect(docsLang(p, api)).toBe('sr-Latn');
    const db = p.model.elements.find((e) => e.id === 'db.main')!;
    expect(docsLang(p, db)).toBe('he');
    expect(displayName(db)).toBe('main');
    expect(hasDocs(db)).toBe(true);
    expect(hasDocs(p.model.elements.find((e) => e.id === 'app.web')!)).toBe(false);
  });

  it('survives a save and an import byte for byte', () => {
    const text = serializeProject(documented());
    expect(serializeProject(parseProject(text))).toBe(text);
    expect(text).toContain('"function": "Proverava korpu i čuva porudžbinu."');
  });

  it('merges later writes: left out keeps, null and "" remove', () => {
    const p = documented();
    const { ops } = documentationOps(p, {
      elements: [{ id: 'svc.api', function: null, description: '  ', sources: [] }],
    });
    const r = applyOps(p, ops, testCatalog);
    expect(r.ok && r.project.model.elements.find((e) => e.id === 'svc.api')!.docs).toEqual({
      name: 'Servis porudžbina',
      basis: 'read',
    });
    // Removing everything removes the documentation.
    const cleared = documentationOps(p, {
      elements: [{ id: 'db.main', description: null, lang: null, basis: null }],
    });
    const r2 = applyOps(p, cleared.ops, testCatalog);
    expect(r2.ok && r2.project.model.elements.find((e) => e.id === 'db.main')!.docs).toBe(
      undefined,
    );
  });

  it('refuses unknown elements, a missing project language and a bad language tag', () => {
    const p = sampleProject();
    const r = documentationOps(p, {
      project: { summary: 'No language' },
      elements: [{ id: 'svc.nope', description: 'x' }],
    });
    expect(r.errors.map((e) => e.code)).toEqual(['SCHEMA_INVALID', 'ID_NOT_FOUND']);
    const bad = documentationOps(p, { elements: [{ id: 'svc.api', lang: 'Serbian' }] });
    expect(applyOps(p, bad.ops, testCatalog)).toMatchObject({
      ok: false,
      errors: [{ code: 'SCHEMA_INVALID' }],
    });
  });

  it('knows which languages are written right to left', () => {
    expect(textDirection(undefined)).toBe(undefined);
    expect(textDirection('en')).toBe('ltr');
    expect(textDirection('sr-Latn')).toBe('ltr');
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('he-IL')).toBe('rtl');
    expect(textDirection('az-Arab')).toBe('rtl');
    expect(textDirection('ar-Latn')).toBe('ltr');
  });

  it('is in ARCHITECTURE.md and the YAML export, untranslated', () => {
    const p = documented();
    const md = exportProject('agent-md', p, testCatalog).files[0]!.content;
    expect(md).toContain('## Documentation');
    expect(md).toContain('Language: `sr-Latn`, written by agent. The texts are shown as written.');
    expect(md).toContain(
      '- `svc.api` **Servis porudžbina** (read, from services/api/README.md)\n  - Description: Backend koji prima porudžbine.\n  - Function: Proverava korpu i čuva porudžbinu.',
    );
    expect(md).toContain(
      '- `db.main` **main** (`he`, deduced)\n  - Description: מסד הנתונים הראשי',
    );
    const yaml = parse(exportProject('agent-yaml', p, testCatalog).files[0]!.content);
    expect(yaml.docs.lang).toBe('sr-Latn');
    expect(yaml.elements.find((e: { id: string }) => e.id === 'svc.api').docs.function).toBe(
      'Proverava korpu i čuva porudžbinu.',
    );
    const onboarding = exportProject('onboarding-md', p, testCatalog).files[0]!.content;
    expect(onboarding).toContain('## What the parts are and do');
    expect(onboarding).toContain('- Function: Proverava korpu i čuva porudžbinu.');
    // No documentation, no section.
    expect(exportProject('agent-md', sampleProject(), testCatalog).files[0]!.content).not.toContain(
      '## Documentation',
    );
  });
});
