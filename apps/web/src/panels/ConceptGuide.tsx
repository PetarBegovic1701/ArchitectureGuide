import { useMemo } from 'react';
import { ArrowRight, Check, ChevronRight, Plus } from 'lucide-react';
import { conceptConnections } from '@archguide/core';
import type { ConceptLink, Element, Project } from '@archguide/core';
import { addConnected } from '../actions';
import { iconFor } from '../canvas/icons';
import { catalog } from '../lib/catalog';
import { elementById } from '../lib/model';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { Markdown } from './Markdown';
import { Menu } from './Menu';

/**
 * What a concept is used for and what it connects to (Implementation.md §13.11). With an
 * element on the canvas, each typical connection has a button that adds and connects the
 * other shape, or connects one that is already there.
 */
export function ConceptGuide({
  kind,
  element,
  showAll = false,
}: {
  kind: string;
  element?: Element;
  showAll?: boolean;
}) {
  const project = useProject((s) => s.project);
  const concept = catalog.concepts.get(kind);
  const guide = catalog.guides.get(kind);
  const { typical, other } = useMemo(() => conceptConnections(catalog, kind), [kind]);
  if (!concept) return null;
  const outs = typical.filter((l) => l.direction === 'out');
  const ins = typical.filter((l) => l.direction === 'in');

  return (
    <div className="space-y-3 text-sm" data-testid={`guide-${kind}`}>
      {guide && guide.examples.length > 0 && (
        <section aria-label="In real projects">
          <Heading>In real projects</Heading>
          <ul className="list-disc space-y-1 pl-4">
            {guide.examples.map((e) => (
              <li key={e}>
                <InlineText text={e} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {outs.length > 0 && (
        <LinkList label="It connects to" links={outs} element={element} project={project} />
      )}
      {ins.length > 0 && (
        <LinkList label="What connects to it" links={ins} element={element} project={project} />
      )}
      {typical.length === 0 && (
        <p className="text-[var(--ag-muted)]">
          {concept.category === 'group'
            ? 'Groups hold other shapes. Draw the arrows between the shapes inside.'
            : 'Shapes of this kind usually have no arrows. They describe something many parts use.'}
        </p>
      )}
      {showAll && other.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
            <ChevronRight size={12} className="transition group-open:rotate-90" aria-hidden />
            Everything else the rules allow
          </summary>
          <ul className="mt-1 space-y-1.5">
            {other.map((g) => (
              <li key={`${g.direction}|${g.type.id}`} className="text-xs">
                <span className="text-[var(--ag-muted)]">
                  {g.direction === 'out' ? `It ${g.type.name}:` : `${cap(g.type.name)} it:`}
                </span>{' '}
                {g.concepts.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ', '}
                    <LearnLink kind={c.id} />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
      {children}
    </h4>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line of text where `backticks` mark code. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <code key={i} className="rounded bg-[var(--ag-panel-2)] px-1 font-mono text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** A concept name that opens its guide in the Learn tab. */
function LearnLink({ kind }: { kind: string }) {
  return (
    <button
      type="button"
      className="text-[var(--ag-accent)] hover:underline"
      onClick={() =>
        // In the editor: the Learn tab. On the learning pages: the text's own page.
        useProject.getState().project
          ? useUi.getState().openLearn({ kind: 'doc', id: kind })
          : (window.location.hash = `#/library/${encodeURIComponent(kind)}`)
      }
    >
      {catalog.concepts.get(kind)?.name ?? kind}
    </button>
  );
}

function LinkList({
  label,
  links,
  element,
  project,
}: {
  label: string;
  links: ConceptLink[];
  element?: Element;
  project: Project | null;
}) {
  return (
    <section aria-label={label}>
      <Heading>{label}</Heading>
      <ul className="space-y-2">
        {links.map((l) => (
          <LinkRow key={`${l.type}|${l.kind}`} link={l} element={element} project={project} />
        ))}
      </ul>
    </section>
  );
}

function LinkRow({
  link,
  element,
  project,
}: {
  link: ConceptLink;
  element?: Element;
  project: Project | null;
}) {
  const partner = catalog.concepts.get(link.kind)!;
  const relation = catalog.relationTypes.get(link.type)!;
  const Icon = iconFor(partner.icon);
  const out = link.direction === 'out';

  // Elements of the partner concept already connected this way, and the others.
  const connected = new Set<string>();
  if (element && project)
    for (const r of project.model.relations) {
      if (r.type !== link.type) continue;
      const partnerId = out ? r.targetId : r.sourceId;
      if (
        (out ? r.sourceId : r.targetId) === element.id &&
        elementById(project, partnerId)?.kind === link.kind
      )
        connected.add(partnerId);
    }
  const candidates = project
    ? project.model.elements.filter(
        (e) => e.kind === link.kind && e.id !== element?.id && !connected.has(e.id),
      )
    : [];
  const what = `${partner.name} (${out ? `this ${relation.name} it` : `it ${relation.name} this`})`;

  return (
    <li
      className="flex items-start gap-2"
      data-testid={`guide-link-${link.direction}-${link.type}-${link.kind}`}
    >
      <Icon size={15} className="mt-0.5 shrink-0 text-[var(--ag-muted)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          {out ? (
            <>
              <span className="font-medium">{relation.name}</span>
              <ArrowRight size={12} aria-hidden className="text-[var(--ag-muted)]" />
              <LearnLink kind={partner.id} />
            </>
          ) : (
            <>
              <LearnLink kind={partner.id} />
              <ArrowRight size={12} aria-hidden className="text-[var(--ag-muted)]" />
              <span className="font-medium">{relation.name}</span>
            </>
          )}
        </div>
        <p className="text-xs text-[var(--ag-muted)]">
          <InlineText text={link.note} />
        </p>
        {connected.size > 0 && project && (
          <p className="flex items-center gap-1 text-xs text-[var(--ag-valid)]">
            <Check size={12} aria-hidden />
            Connected: {[...connected].map((id) => elementById(project, id)?.name ?? id).join(', ')}
          </p>
        )}
      </div>
      {element &&
        (candidates.length > 0 ? (
          <Menu
            label={`Add or connect ${what}`}
            iconOnly
            align="right"
            icon={<Plus size={14} aria-hidden />}
            items={[
              { label: `New ${partner.name}`, run: () => addConnected(element.id, link) },
              ...candidates.slice(0, 8).map((c) => ({
                label: `Connect ${c.name}`,
                run: () => addConnected(element.id, link, c.id),
              })),
            ]}
          />
        ) : (
          <button
            type="button"
            className="ag-touch flex shrink-0 items-center justify-center rounded border border-[var(--ag-border)] p-1 hover:bg-[var(--ag-panel-2)]"
            aria-label={`Add ${what}`}
            title={`Add a ${partner.name} and connect it`}
            onClick={() => addConnected(element.id, link)}
          >
            <Plus size={14} />
          </button>
        ))}
    </li>
  );
}

/** The guide above a shape's properties: what it is, where it is used, what it connects to. */
export function GuideCard({ element }: { element: Element }) {
  const open = useUi((s) => s.guideOpen);
  const concept = catalog.concepts.get(element.kind);
  if (!concept) return null;
  return (
    <details
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now !== useUi.getState().guideOpen) useUi.getState().set({ guideOpen: now });
      }}
      className="group mb-3 rounded border border-[var(--ag-border)] bg-[var(--ag-panel-2)] p-2"
      data-testid="concept-guide"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-semibold">
        <ChevronRight size={14} className="transition group-open:rotate-90" aria-hidden />
        About: {concept.name}
      </summary>
      <div className="mt-2 space-y-3">
        <Markdown>{concept.docs}</Markdown>
        <ConceptGuide kind={element.kind} element={element} />
        <button
          type="button"
          className="text-xs text-[var(--ag-accent)] hover:underline"
          onClick={() => useUi.getState().openLearn({ kind: 'selection' })}
        >
          More in the Learn tab
        </button>
      </div>
    </details>
  );
}
