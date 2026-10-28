import type { CategoryId } from '../catalog';
import type { Element, Id, Relation } from '../schema';
import type { Facts } from './facts';

/** Identifiers for LikeC4, Structurizr and PlantUML: letters, digits and "_". */
const ident = (id: string) => id.replace(/[.-]/g, '_');
const sq = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const dq = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const oneLine = (text?: string) => (text ?? '').replace(/\s+/g, ' ').trim();
const describe = (e: Element) => oneLine(e.description ?? e.responsibilities?.join('; '));

function childrenOf(f: Facts): Map<Id | undefined, Element[]> {
  const map = new Map<Id | undefined, Element[]>();
  for (const e of f.elements) {
    const parent = e.parentId && f.included.has(e.parentId) ? e.parentId : undefined;
    map.set(parent, [...(map.get(parent) ?? []), e]);
  }
  for (const list of map.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
  return map;
}

const relationText = (f: Facts, r: Relation) =>
  [f.catalog.relationTypes.get(r.type)?.name ?? r.type, r.label].filter(Boolean).join(': ');

// --- LikeC4 --------------------------------------------------------------------------

const LIKEC4_SHAPES: Partial<Record<CategoryId, string>> = {
  actor: 'person',
  'data-at-rest': 'cylinder',
  'data-in-motion': 'queue',
  ui: 'browser',
};

/**
 * LikeC4 (§18.7): a `specification` with the element kinds and relationship kinds the model
 * uses, a nested `model`, and one view per project view plus an overview.
 */
export function likec4(f: Facts): string {
  const kids = childrenOf(f);
  const kinds = [...new Set(f.elements.map((e) => e.kind))].sort();
  const relKinds = [...new Set(f.relations.map((r) => r.type))].sort();
  const lines = ['specification {'];
  for (const k of kinds) {
    const concept = f.catalog.concepts.get(k);
    const shape = concept ? LIKEC4_SHAPES[concept.category] : undefined;
    const parts = [
      `notation ${sq(concept?.name ?? k)}`,
      ...(shape ? ['style {', `  shape ${shape}`, '}'] : []),
    ];
    lines.push(`  element ${ident(k)} {`, ...parts.map((p) => `    ${p}`), '  }');
  }
  for (const t of relKinds) {
    const type = f.catalog.relationTypes.get(t);
    const dashed = type?.mode === 'async';
    lines.push(`  relationship ${ident(t)}${dashed ? ' {\n    line dashed\n  }' : ''}`);
  }
  lines.push('}', '', 'model {');
  const fqn = new Map<Id, string>();
  const element = (e: Element, path: string, indent: string) => {
    const name = path ? `${path}.${ident(e.id)}` : ident(e.id);
    fqn.set(e.id, name);
    const body: string[] = [];
    if (describe(e)) body.push(`description ${sq(describe(e))}`);
    if (e.tech) body.push(`technology ${sq(e.tech)}`);
    const children = kids.get(e.id) ?? [];
    lines.push(
      `${indent}${ident(e.id)} = ${ident(e.kind)} ${sq(e.name)}${body.length || children.length ? ' {' : ''}`,
    );
    for (const b of body) lines.push(`${indent}  ${b}`);
    for (const c of children) element(c, name, `${indent}  `);
    if (body.length || children.length) lines.push(`${indent}}`);
  };
  for (const e of kids.get(undefined) ?? []) element(e, '', '  ');
  if (f.relations.length) lines.push('');
  for (const r of f.relations) {
    const label = r.label ?? f.catalog.relationTypes.get(r.type)?.name ?? r.type;
    lines.push(
      `  ${fqn.get(r.sourceId)} -[${ident(r.type)}]-> ${fqn.get(r.targetId)} ${sq(label)}`,
    );
  }
  lines.push(
    '}',
    '',
    'views {',
    '  view index {',
    `    title ${sq(f.project.name)}`,
    '    include *',
    '  }',
  );
  for (const v of f.project.views) {
    const shown = v.nodes.map((n) => n.elementId).filter((id) => fqn.has(id));
    if (!shown.length) continue;
    const scope = v.scopeElementId && fqn.get(v.scopeElementId);
    lines.push(
      `  view ${ident(v.id)}${scope ? ` of ${scope}` : ''} {`,
      `    title ${sq(v.name)}`,
      `    include ${shown.map((id) => fqn.get(id)).join(', ')}`,
      '  }',
    );
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

// --- Structurizr DSL -----------------------------------------------------------------

/**
 * Structurizr DSL (§18.7): deployables → containers, inner elements → components, data →
 * containers tagged Database, actors → people, externals → software systems tagged External.
 */
export function structurizr(f: Facts): string {
  const g = f.graph;
  const cat = (e: Element) => g.category(e);
  const isOuter = (e: Element) =>
    !g.ancestors(e.id).some((a) => f.included.has(a.id) && cat(a) !== 'group');
  const people = f.elements.filter((e) => cat(e) === 'actor');
  const externals = f.elements.filter((e) => cat(e) === 'external' && isOuter(e));
  const containers = f.elements.filter(
    (e) => isOuter(e) && !['actor', 'external', 'group'].includes(cat(e) ?? ''),
  );
  const containerOf = (e: Element): Element | undefined =>
    [e, ...g.ancestors(e.id)].find((x) => containers.includes(x));
  const system = ident(f.project.id);
  const path = new Map<Id, string>();
  for (const p of people) path.set(p.id, ident(p.id));
  for (const x of externals) path.set(x.id, ident(x.id));
  const tagsOf = (e: Element) => {
    const c = cat(e);
    return c === 'data-at-rest' ? 'Database' : c === 'data-in-motion' ? 'Queue' : '';
  };
  const lines = [
    `workspace ${dq(f.project.name)} ${dq(oneLine(f.project.description))} {`,
    '  !identifiers hierarchical',
    '',
    '  model {',
  ];
  for (const p of people)
    lines.push(`    ${ident(p.id)} = person ${dq(p.name)} ${dq(describe(p))}`);
  for (const x of externals)
    lines.push(`    ${ident(x.id)} = softwareSystem ${dq(x.name)} ${dq(describe(x))} "External"`);
  lines.push(`    ${system} = softwareSystem ${dq(f.project.name)} {`);
  const withComponents: string[] = [];
  for (const c of containers) {
    const id = ident(c.id);
    path.set(c.id, `${system}.${id}`);
    const inner = f.elements.filter(
      (e) => e.id !== c.id && containerOf(e) === c && cat(e) !== 'group',
    );
    const head = `      ${id} = container ${dq(c.name)} ${dq(describe(c))} ${dq(c.tech ?? '')}${tagsOf(c) ? ` ${dq(tagsOf(c))}` : ''}`;
    if (!inner.length) {
      lines.push(head);
      continue;
    }
    withComponents.push(c.id);
    lines.push(`${head} {`);
    for (const e of inner) {
      path.set(e.id, `${system}.${id}.${ident(e.id)}`);
      lines.push(
        `        ${ident(e.id)} = component ${dq(e.name)} ${dq(describe(e))} ${dq(e.tech ?? '')}${tagsOf(e) ? ` ${dq(tagsOf(e))}` : ''}`,
      );
    }
    lines.push('      }');
  }
  lines.push('    }', '');
  const seen = new Set<string>();
  for (const r of f.relations) {
    const [s, t] = [path.get(r.sourceId), path.get(r.targetId)];
    // Structurizr refuses relations between an element and its own parent.
    if (!s || !t || s === t || s.startsWith(`${t}.`) || t.startsWith(`${s}.`)) continue;
    const key = `${s}>${t}>${relationText(f, r)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `    ${s} -> ${t} ${dq(relationText(f, r))}${r.protocol ? ` ${dq(r.protocol)}` : ''}`,
    );
  }
  lines.push(
    '  }',
    '',
    '  views {',
    `    systemContext ${system} "Context" {`,
    '      include *',
    '      autolayout lr',
    '    }',
    `    container ${system} "Containers" {`,
    '      include *',
    '      autolayout lr',
    '    }',
  );
  for (const id of withComponents)
    lines.push(
      `    component ${system}.${ident(id)} ${dq(`${ident(id)}-components`)} {`,
      '      include *',
      '      autolayout lr',
      '    }',
    );
  lines.push(
    '    styles {',
    '      element "Person" {',
    '        shape Person',
    '      }',
    '      element "Database" {',
    '        shape Cylinder',
    '      }',
    '      element "Queue" {',
    '        shape Pipe',
    '      }',
    '      element "External" {',
    '        background #999999',
    '        color #ffffff',
    '      }',
    '    }',
    '  }',
    '}',
  );
  return `${lines.join('\n')}\n`;
}

// --- C4-PlantUML ---------------------------------------------------------------------

/**
 * C4-PlantUML: a container diagram of the project, or, with a deployable as the focus, the
 * component diagram inside it. Relations are lifted to the shown level.
 */
export function plantuml(f: Facts, focus?: Id): string {
  const g = f.graph;
  const cat = (e: Element) => g.category(e);
  const scope = focus ? g.element(focus) : undefined;
  const componentLevel = Boolean(scope && cat(scope) === 'deployable');
  const lines = [
    '@startuml',
    componentLevel ? '!include <C4/C4_Component>' : '!include <C4/C4_Container>',
    '',
    `title ${componentLevel ? `${scope!.name} – components` : `${f.project.name} – containers`}`,
    '',
  ];
  const macro = (e: Element, level: 'Container' | 'Component') => {
    const c = cat(e);
    if (c === 'actor') return 'Person';
    if (c === 'external') return 'System_Ext';
    if (c === 'data-at-rest') return `${level}Db`;
    if (c === 'data-in-motion') return `${level}Queue`;
    return level;
  };
  const line = (e: Element, level: 'Container' | 'Component', indent = '') => {
    const m = macro(e, level);
    if (m === 'Person' || m === 'System_Ext')
      return `${indent}${m}(${ident(e.id)}, ${dq(e.name)}, ${dq(describe(e))})`;
    return `${indent}${m}(${ident(e.id)}, ${dq(e.name)}, ${dq(e.tech ?? '')}, ${dq(describe(e))})`;
  };
  // What each element is drawn as: itself, or the nearest shown ancestor.
  const shownAs = new Map<Id, Id>();
  if (componentLevel) {
    const inner = g.subtree(scope!.id).filter((e) => e.id !== scope!.id && f.included.has(e.id));
    const outside = f.elements.filter((e) => !g.subtree(scope!.id).some((x) => x.id === e.id));
    const tops = outside.filter(
      (e) => !e.parentId || !f.included.has(e.parentId) || cat(e) === 'actor',
    );
    for (const e of f.elements) {
      const chain = [e, ...g.ancestors(e.id)];
      const hit =
        chain.find((x) => inner.includes(x) && x.parentId === scope!.id) ??
        chain.find((x) => tops.includes(x));
      if (hit) shownAs.set(e.id, hit.id);
    }
    for (const e of tops)
      if ([...shownAs.values()].includes(e.id)) lines.push(line(e, 'Container'));
    lines.push(`Container_Boundary(${ident(scope!.id)}, ${dq(scope!.name)}) {`);
    for (const e of inner.filter((x) => x.parentId === scope!.id))
      lines.push(line(e, 'Component', '  '));
    lines.push('}');
  } else {
    const isTop = (e: Element) =>
      !g.ancestors(e.id).some((a) => f.included.has(a.id) && cat(a) !== 'group');
    const tops = f.elements.filter((e) => isTop(e) && cat(e) !== 'group');
    for (const e of f.elements) {
      const hit = [e, ...g.ancestors(e.id)].find((x) => tops.includes(x));
      if (hit) shownAs.set(e.id, hit.id);
    }
    const outside = tops.filter((e) => cat(e) === 'actor' || cat(e) === 'external');
    for (const e of outside) lines.push(line(e, 'Container'));
    lines.push(`System_Boundary(${ident(f.project.id)}, ${dq(f.project.name)}) {`);
    for (const e of tops.filter((x) => !outside.includes(x)))
      lines.push(line(e, 'Container', '  '));
    lines.push('}');
  }
  lines.push('');
  const seen = new Set<string>();
  for (const r of f.relations) {
    const [s, t] = [shownAs.get(r.sourceId), shownAs.get(r.targetId)];
    if (!s || !t || s === t) continue;
    const key = `${s}>${t}>${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `Rel(${ident(s)}, ${ident(t)}, ${dq(relationText(f, r))}${r.protocol ? `, ${dq(r.protocol)}` : ''})`,
    );
  }
  lines.push('', 'SHOW_LEGEND()', '@enduml');
  return `${lines.join('\n')}\n`;
}
