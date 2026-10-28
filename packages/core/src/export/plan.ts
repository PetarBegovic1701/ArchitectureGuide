import type { Catalog } from '../catalog';
import {
  changeSetDiff,
  changeSetFindings,
  describeChanges,
  effectiveProject,
  generateTasks,
  invariantsAbout,
  relationStep,
} from '../changesets';
import type { ChangeRow, ChangeSetState } from '../changesets';
import type { ProjectDiff } from '../diff';
import { slugify } from '../ids';
import type { Finding } from '../rules';
import type { ChangeSet, Element, Id, Project, Relation, Task } from '../schema';
import { countFindings } from '../tools/findings';
import { computeFacts, neighborhood } from './facts';
import type { Facts, Invariant } from './facts';
import { mermaid } from './formats';
import { elementsTable, table } from './markdown';
import type { ExportFile } from './types';

const MARKDOWN = 'text/markdown';

/** Everything the plan formats show about one change set (Implementation.md §18.4, §18.6). */
export interface Plan {
  changeSet: ChangeSet;
  state: ChangeSetState;
  diff: ProjectDiff;
  rows: ChangeRow[];
  tasks: Task[];
  /** Elements the change adds or changes, and the ends of the relations it adds or changes. */
  touched: Id[];
  invariants: Invariant[];
  findings: { all: Finding[]; introduced: Finding[] };
  /** The changed elements and their direct neighbors, on baseline + change. */
  facts: Facts;
}

export function planOf(project: Project, catalog: Catalog, changeSetId: Id): Plan {
  const changeSet = project.changeSets.find((c) => c.id === changeSetId);
  if (!changeSet) throw new Error(`Unknown change set "${changeSetId}".`);
  const state = effectiveProject(project, changeSet, catalog);
  const diff = changeSetDiff(state);
  const eff = state.effective;
  const relation = (id: Id) => eff.model.relations.find((r) => r.id === id)!;
  const touched = [
    ...new Set([
      ...diff.added.elements,
      ...diff.changed.filter((c) => c.kind === 'element').map((c) => c.id),
      ...[
        ...diff.added.relations,
        ...diff.changed.filter((c) => c.kind === 'relation').map((c) => c.id),
      ]
        .map(relation)
        .flatMap((r) => [r.sourceId, r.targetId]),
    ]),
  ].sort();
  const near = new Set<Id>();
  for (const id of touched) for (const x of neighborhood(eff, catalog, id, 1)) near.add(x);
  return {
    changeSet,
    state,
    diff,
    rows: describeChanges(project, eff),
    tasks: changeSet.tasks?.length ? changeSet.tasks : generateTasks(project, changeSet, catalog),
    touched,
    invariants: invariantsAbout(eff, catalog)(touched),
    findings: changeSetFindings(state, catalog),
    facts: computeFacts(eff, catalog, {}, near),
  };
}

// --- shared sections -----------------------------------------------------------------

function changesTable(plan: Plan): string {
  if (!plan.rows.length) return '_No model changes yet._';
  return table(
    ['Op', 'Item', 'Details'],
    plan.rows.map((r) => [r.op, r.item, r.details]),
  );
}

function conflictsList(plan: Plan): string {
  return plan.state.conflicts
    .map((c) => `- Op ${c.index + 1} (${c.op.op}) no longer applies: ${c.message}`)
    .join('\n');
}

function invariantLines(plan: Plan): string {
  return plan.invariants.map((i) => `- ${i.text} (${i.source})`).join('\n');
}

function ruleCheck(plan: Plan): string {
  const counts = countFindings(plan.findings.all);
  const introduced = plan.findings.introduced.filter((f) => !f.suppressed);
  const line = (label: string, sev: Finding['severity']) => {
    const mine = introduced.filter((f) => f.severity === sev);
    const list = mine.map((f) => `${f.ruleId} ${f.message.replace(/\.$/, '')}`).join('; ');
    return `- ${label}: ${counts[sev]}${mine.length ? ` (new: ${list})` : ''}`;
  };
  return [
    line('Errors', 'error'),
    line('Warnings', 'warning'),
    line('Info', 'info'),
    introduced.length
      ? `\n${introduced.length} finding(s) are introduced by this change.`
      : '\nThis change introduces no new findings.',
  ].join('\n');
}

const section = (title: string, body: string) =>
  body.trim() ? `## ${title}\n\n${body.trim()}` : '';

const join = (blocks: string[]) => `${blocks.filter((b) => b.trim()).join('\n\n')}\n`;

/** Task detail: the first line goes after the title, the rest is indented under it. */
function taskBody(t: Task, indent: string): { head: string; rest: string[] } {
  const [head = '', ...rest] = (t.detail ?? '').split('\n');
  return { head, rest: rest.map((l) => `${indent}${l.startsWith('- ') ? l : `- ${l}`}`) };
}

function numberedTasks(plan: Plan): string {
  const lines: string[] = [];
  plan.tasks.forEach((t, i) => {
    const { head, rest } = taskBody(t, '   ');
    lines.push(
      `${i + 1}. **${t.title}**${t.done ? ' (done)' : ''}${head ? `: ${head}` : ''}`,
      ...rest,
    );
  });
  lines.push(`${plan.tasks.length + 1}. Run \`archguide check\`.`);
  return lines.join('\n');
}

function diagram(plan: Plan): string {
  const marks = {
    added: [...plan.diff.added.elements],
    changed: plan.diff.changed.filter((c) => c.kind === 'element').map((c) => c.id),
  };
  return `\`\`\`mermaid\n${mermaid(plan.facts, marks).trimEnd()}\n\`\`\``;
}

// --- plan-md -------------------------------------------------------------------------

/** `plans/<id>.md`: the change-set plan for an agent or a reviewer (§18.4). */
export function planMarkdown(project: Project, plan: Plan): string {
  const cs = plan.changeSet;
  return join([
    [
      '---',
      'archguide: 1',
      `project: ${project.id}`,
      `changeSet: ${cs.id}`,
      `status: ${cs.status}`,
      `baseRevision: ${cs.baseRevision}`,
      '---',
    ].join('\n'),
    `# Plan: ${cs.name}`,
    cs.description.trim()
      ? cs.description
          .trim()
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n')
      : '',
    section('Changes', changesTable(plan)),
    section('Conflicts with the baseline', conflictsList(plan)),
    section('Invariants this change must respect', invariantLines(plan)),
    section('Rule check (baseline + change)', ruleCheck(plan)),
    section('Tasks', numberedTasks(plan)),
  ]);
}

// --- Spec Kit ------------------------------------------------------------------------

/** "When the change is built, …" sentences: one per added relation and endpoint. */
function requirementsOf(plan: Plan, catalog: Catalog): { about: Id[]; text: string }[] {
  const eff = plan.state.effective;
  const out: { about: Id[]; text: string }[] = [];
  for (const id of plan.diff.added.elements) {
    const e = eff.model.elements.find((x) => x.id === id)!;
    const { method, path } = e.properties ?? {};
    if (typeof method === 'string' && typeof path === 'string')
      out.push({ about: [id], text: endpointSentence(e, method, path) });
  }
  for (const id of plan.diff.added.relations) {
    const r = eff.model.relations.find((x) => x.id === id)!;
    out.push({ about: [r.sourceId, r.targetId], text: ears(r, catalog) });
  }
  return out;
}

function endpointSentence(e: Element, method: string, path: string): string {
  const where = e.parentId ? ` in \`${e.parentId}\`` : '';
  return `WHEN a client sends \`${method} ${path}\`, THE SYSTEM SHALL handle it${where} ("${e.name}").`;
}

/** EARS sentence for an added relation (§18.6). */
export function ears(r: Relation, catalog: Catalog): string {
  const [a, b] = [`\`${r.sourceId}\``, `\`${r.targetId}\``];
  const what = r.label ? ` \`${r.label}\`` : '';
  const tx = r.inTransaction ? ' in the same transaction as its data change' : '';
  switch (r.type) {
    case 'enqueues':
    case 'publishes':
      return `WHEN ${a} completes the action, THE SYSTEM SHALL ${r.type === 'enqueues' ? 'enqueue' : 'publish'}${what || ' a message'} on ${b}${tx}.`;
    case 'processes':
    case 'consumes':
    case 'listens':
      return `WHEN a message${what} arrives on ${b}, THE SYSTEM SHALL handle it in ${a}.`;
    case 'writes':
      return `WHEN ${a} changes data, THE SYSTEM SHALL store it in ${b}${tx}.`;
    case 'reads':
      return `WHEN ${a} needs data${what}, THE SYSTEM SHALL read it from ${b}.`;
    case 'calls':
      return `WHEN ${a} needs ${b}${what ? ` for${what}` : ''}, THE SYSTEM SHALL call it${r.protocol ? ` over ${r.protocol}` : ''}.`;
    default: {
      const step = relationStep(r, catalog);
      return `WHEN ${a} runs, THE SYSTEM SHALL ${step.charAt(0).toLowerCase()}${step.slice(1)}.`;
    }
  }
}

const featureSlug = (cs: ChangeSet) => slugify(cs.name);
const featureNumber = (project: Project, cs: ChangeSet) =>
  String(project.changeSets.findIndex((c) => c.id === cs.id) + 1).padStart(3, '0');

function checkboxTasks(plan: Plan, numbered: (i: number) => string, extra?: (t: Task) => string[]) {
  const lines: string[] = [];
  plan.tasks.forEach((t, i) => {
    const { head, rest } = taskBody(t, '  ');
    lines.push(
      `- [${t.done ? 'x' : ' '}] ${numbered(i)} ${t.title}${head ? `: ${head}` : ''}`,
      ...rest,
      ...(extra?.(t) ?? []),
    );
  });
  lines.push(`- [ ] ${numbered(plan.tasks.length)} Run \`archguide check\``);
  return lines.join('\n');
}

/** `specs/<n>-<slug>/{spec,plan,tasks}.md` for GitHub Spec Kit (§18.6). */
export function specKit(project: Project, plan: Plan, catalog: Catalog): ExportFile[] {
  const cs = plan.changeSet;
  const dir = `specs/${featureNumber(project, cs)}-${featureSlug(cs)}`;
  const reqs = requirementsOf(plan, catalog);
  const spec = join([
    `# Feature Specification: ${cs.name}`,
    [
      `**Feature branch**: \`${featureNumber(project, cs)}-${featureSlug(cs)}\``,
      `**Created**: ${cs.createdAt.slice(0, 10)}`,
      `**Status**: ${cs.status}`,
      `**Architecture**: change set \`${cs.id}\` of \`${project.id}\` (base revision ${cs.baseRevision})`,
    ].join('  \n'),
    section('Summary', cs.description || cs.name),
    section(
      'Acceptance criteria',
      plan.tasks
        .map((t, i) => `${i + 1}. ${t.title} is built and \`archguide check\` passes.`)
        .join('\n'),
    ),
    section(
      'Functional requirements',
      reqs.map((r, i) => `- **FR-${String(i + 1).padStart(3, '0')}**: ${r.text}`).join('\n'),
    ),
  ]);
  const planMd = join([
    `# Implementation Plan: ${cs.name}`,
    `**Spec**: [spec.md](./spec.md)  \n**Change set**: \`${cs.id}\``,
    section('Summary', cs.description),
    section('Changes', changesTable(plan)),
    section('Conflicts with the baseline', conflictsList(plan)),
    section('Invariants', invariantLines(plan)),
    section('Affected elements', elementsTable(plan.facts)),
    section('Diagram', diagram(plan)),
    section('Rule check (baseline + change)', ruleCheck(plan)),
  ]);
  const tasks = join([
    `# Tasks: ${cs.name}`,
    `**Input**: [plan.md](./plan.md)`,
    checkboxTasks(plan, (i) => `T${String(i + 1).padStart(3, '0')}`),
  ]);
  return [
    { path: `${dir}/spec.md`, content: spec, mime: MARKDOWN },
    { path: `${dir}/plan.md`, content: planMd, mime: MARKDOWN },
    { path: `${dir}/tasks.md`, content: tasks, mime: MARKDOWN },
  ];
}

// --- Kiro ----------------------------------------------------------------------------

/** `.kiro/specs/<slug>/{requirements,design,tasks}.md` for Kiro (§18.6). */
export function kiro(project: Project, plan: Plan, catalog: Catalog): ExportFile[] {
  const cs = plan.changeSet;
  const dir = `.kiro/specs/${featureSlug(cs)}`;
  const reqs = requirementsOf(plan, catalog);
  // One requirement per task; its criteria are the sentences about the task's elements.
  const groups = plan.tasks
    .map((t) => ({
      task: t,
      criteria: reqs.filter((r) => r.about[0] && t.elementIds.includes(r.about[0])),
    }))
    .filter((g) => g.criteria.length || !g.task.title.startsWith('Remove '));
  const requirementOf = new Map(groups.map((g, i) => [g.task.id, i + 1]));
  const requirements = join([
    '# Requirements Document',
    section(
      'Introduction',
      `${cs.description || cs.name}\n\nArchitecture change set: \`${cs.id}\` in \`${project.id}\`.`,
    ),
    section(
      'Requirements',
      groups
        .map((g, i) => {
          const criteria = g.criteria.length
            ? g.criteria.map((c, j) => `${j + 1}. ${c.text}`)
            : [
                `1. WHEN the change is deployed, THE SYSTEM SHALL provide ${g.task.elementIds.map((id) => `\`${id}\``).join(', ')} as the design describes.`,
              ];
          return [
            `### Requirement ${i + 1}: ${g.task.title}`,
            '',
            `**User Story:** As a developer, I want to ${g.task.title.charAt(0).toLowerCase()}${g.task.title.slice(1)}, so that the change "${cs.name}" works as designed.`,
            '',
            '#### Acceptance Criteria',
            '',
            ...criteria,
          ].join('\n');
        })
        .join('\n\n'),
    ),
  ]);
  const design = join([
    `# Design Document: ${cs.name}`,
    section('Overview', cs.description),
    section('Architecture', diagram(plan)),
    section('Changes', changesTable(plan)),
    section('Components and interfaces', elementsTable(plan.facts)),
    section('Invariants', invariantLines(plan)),
    section('Conflicts with the baseline', conflictsList(plan)),
    section('Rule check (baseline + change)', ruleCheck(plan)),
  ]);
  const tasks = join([
    '# Implementation Plan',
    checkboxTasks(
      plan,
      (i) => `${i + 1}.`,
      (t) => (requirementOf.has(t.id) ? [`  - _Requirements: ${requirementOf.get(t.id)}_`] : []),
    ),
  ]);
  return [
    { path: `${dir}/requirements.md`, content: requirements, mime: MARKDOWN },
    { path: `${dir}/design.md`, content: design, mime: MARKDOWN },
    { path: `${dir}/tasks.md`, content: tasks, mime: MARKDOWN },
  ];
}
