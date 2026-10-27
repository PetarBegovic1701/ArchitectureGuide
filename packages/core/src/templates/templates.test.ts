import { describe, expect, it } from 'vitest';
import { applyOps } from '../ops';
import { createProject } from '../project';
import type { Project } from '../schema';
import { NOW, testCatalog } from '../test-support/fixtures';
import {
  TemplateError,
  instantiateTemplate,
  parseTemplateFile,
  renderInvariants,
  resolveParams,
  serializeTemplateFile,
  templateFromFile,
  templateFromSelection,
} from '.';
import type { Template } from '.';

const services: Template = {
  id: 'test.services',
  code: 'TX',
  version: '1.2.0',
  name: 'Services',
  category: 'backend',
  summary: 'A service per name, each with its own database.',
  whenToUse: [],
  whenNotToUse: [],
  tradeoffs: [],
  parameters: [
    { key: 'app', label: 'App name', type: 'string', default: 'Shop' },
    {
      key: 'services',
      label: 'Services',
      type: 'string[]',
      default: ['Orders', 'Billing'],
      max: 4,
    },
    { key: 'replicas', label: 'Replicas', type: 'number', default: 2, min: 1, max: 5 },
    { key: 'style', label: 'Style', type: 'enum', options: ['rest', 'rpc'], default: 'rest' },
  ],
  rulePacks: ['microservices', 'hexagonal'],
  invariants: ['Only {services} may write their own databases in {app}.'],
  folderLayout: { 't.module': 'services/{app}/src/**' },
  build(params, b) {
    b.el('web', 't.app', `${String(params.app)} web`, { x: 0, y: 0 });
    (params.services as string[]).forEach((name, i) => {
      b.el(`svc${i}`, 't.service', name, { x: 240, y: i * 200 });
      b.el(`mod${i}`, 't.module', `${name} core`, { parent: `svc${i}`, x: 16, y: 32 });
      b.el(`db${i}`, 't.db', `${name} DB`, { x: 480, y: i * 200 });
      b.rel('web', 'calls', `svc${i}`, { protocol: 'http' });
      b.rel(`mod${i}`, 'writes', `db${i}`);
    });
    b.step({ title: 'Start here', body: 'The {app} web app.', elements: ['web'] });
    b.step({ title: 'Data', body: 'Each service owns its data.', relations: ['mod0>writes>db0'] });
  },
};

const empty = (): Project =>
  createProject({ id: 'p', name: 'P', profile: 'test', now: NOW, rulePacks: ['core'] });

function apply(p: Project, template: Template, options = {}): Project {
  const { ops } = instantiateTemplate(template, p, testCatalog, options);
  const result = applyOps(p, ops, testCatalog);
  if (!result.ok) throw new Error(JSON.stringify(result.errors[0]));
  return result.project;
}

describe('template parameters', () => {
  it('fills defaults and checks values', () => {
    expect(resolveParams(services).errors).toEqual({});
    const { errors } = resolveParams(services, {
      app: '  ',
      services: ['A', 'a'],
      replicas: 9,
      style: 'soap',
    });
    expect(Object.keys(errors).sort()).toEqual(['app', 'replicas', 'services', 'style']);
    expect(resolveParams(services, { services: 'A, B,  C' }).values.services).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('renders invariants with values', () => {
    expect(renderInvariants(services, resolveParams(services).values)).toEqual([
      'Only Orders, Billing may write their own databases in Shop.',
    ]);
  });

  it('refuses to build with invalid parameters', () => {
    expect(() =>
      instantiateTemplate(services, empty(), testCatalog, { params: { services: [] } }),
    ).toThrow(TemplateError);
  });
});

describe('instantiateTemplate', () => {
  it('adds elements, relations, view nodes, the tour, derivedFrom and rule packs', () => {
    const p = apply(empty(), services, { origin: { x: 100, y: 50 } });
    expect(p.model.elements.map((e) => e.id).sort()).toEqual([
      'app.shop-web',
      'db.billing-db',
      'db.orders-db',
      'mod.billing-core',
      'mod.orders-core',
      'svc.billing',
      'svc.orders',
    ]);
    expect(p.model.relations).toHaveLength(4);
    expect(p.model.elements.every((e) => e.status === 'planned')).toBe(true);
    const node = (id: string) => p.views[0]!.nodes.find((n) => n.elementId === id);
    expect(node('svc.billing')).toMatchObject({ x: 340, y: 250 });
    expect(node('mod.billing-core')).toMatchObject({ x: 16, y: 32 }); // relative to its parent
    expect(p.views[0]!.edges).toHaveLength(4);
    expect(p.model.elements.find((e) => e.id === 'mod.orders-core')?.codePaths).toEqual([
      'services/Shop/src/**',
    ]);
    expect(p.tours[0]).toMatchObject({
      id: 'tour.test-services',
      steps: [
        { title: 'Start here', body: 'The Shop web app.', elementIds: ['app.shop-web'] },
        { relationIds: ['rel.mod-orders-core-writes-db-orders-db'] },
      ],
    });
    expect(p.derivedFrom).toEqual([
      {
        templateId: 'test.services',
        templateVersion: '1.2.0',
        rootIds: ['app.shop-web', 'svc.orders', 'db.orders-db', 'svc.billing', 'db.billing-db'],
      },
    ]);
    expect(p.settings.rulePacks).toEqual(['core', 'microservices', 'hexagonal']);
  });

  it('can be used twice in one project: IDs stay unique', () => {
    const twice = apply(apply(empty(), services), services);
    const ids = [...twice.model.elements, ...twice.model.relations].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(twice.model.elements).toHaveLength(14);
    expect(twice.tours.map((t) => t.id)).toEqual(['tour.test-services', 'tour.test-services-2']);
    expect(twice.derivedFrom).toHaveLength(2);
  });

  it('applies as one undo step', () => {
    const before = empty();
    const { ops } = instantiateTemplate(services, before, testCatalog);
    const result = applyOps(before, ops, testCatalog);
    if (!result.ok) throw new Error('apply failed');
    const undone = applyOps(result.project, result.inverse, testCatalog);
    if (!undone.ok) throw new Error('undo failed');
    expect(undone.project).toEqual(before);
  });

  it('reports a template bug clearly', () => {
    const broken: Template = { ...services, build: (_p, b) => void b.rel('a', 'calls', 'b') };
    expect(() => instantiateTemplate(broken, empty(), testCatalog)).toThrow(/unknown source "a"/);
  });
});

describe('templates saved from a selection', () => {
  it('round-trips through a file and recreates the selection with new IDs', () => {
    const p = apply(empty(), services, { origin: { x: 100, y: 50 } });
    const file = templateFromSelection(p, p.views[0]!, ['svc.orders', 'db.orders-db'], {
      id: 'orders-slice',
      name: 'Orders slice',
    });
    // The module comes along with its service; the web app and its call do not.
    expect(file.elements.map((e) => e.id).sort()).toEqual([
      'db.orders-db',
      'mod.orders-core',
      'svc.orders',
    ]);
    expect(file.relations.map((r) => r.type)).toEqual(['writes']);
    expect(file.nodes.find((n) => n.elementId === 'svc.orders')).toMatchObject({ x: 0, y: 0 });
    expect(file.nodes.find((n) => n.elementId === 'db.orders-db')).toMatchObject({ x: 240, y: 0 });

    const parsed = parseTemplateFile(serializeTemplateFile(file));
    expect(parsed).toEqual(file);
    const again = apply(p, templateFromFile(parsed), { origin: { x: 0, y: 600 } });
    expect(again.model.elements.map((e) => e.id)).toContain('mod.orders-core-2');
    expect(again.model.elements.find((e) => e.id === 'mod.orders-core-2')?.parentId).toBe(
      'svc.orders-2',
    );
  });

  it('rejects files that are not templates', () => {
    expect(() => parseTemplateFile('{')).toThrow(/not valid JSON/);
    expect(() => parseTemplateFile('{"format":"other"}')).toThrow(
      /Not an ArchitectureGuide template/,
    );
  });
});
