import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RULE_PACKS } from '@archguide/core';
import type { LearningDoc, Level } from '@archguide/core';
import { catalog, conceptOf } from '../lib/catalog';
import { docFor, relatedDocs, textAt } from '../lib/learn';
import { elementById } from '../lib/model';
import { RULES, SEVERITY_COLOR, severityLabel } from '../lib/findings';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="ag-md text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The Learn tab (§17.7): the learning text for the selection, a refused connection, or a
 * chosen text, at the reader's level.
 */
export function LearnPanel() {
  const target = useUi((s) => s.learnTarget);
  const level = useUi((s) => s.level);
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  const open = (id: string) => useUi.getState().openLearn({ kind: 'doc', id });

  if (target.kind === 'doc') {
    return <Subject id={target.id} level={level} onOpen={open} back />;
  }
  if (target.kind === 'rule') {
    return <RuleView id={target.id} level={level} onOpen={open} />;
  }
  if (target.kind === 'refusal') {
    const source = conceptOf(target.sourceKind);
    const target2 = conceptOf(target.targetKind);
    return (
      <div className="space-y-3" data-testid="learn-refusal">
        <BackButton />
        <h3 className="text-sm font-semibold">Why this connection is not allowed</h3>
        <p className="rounded border border-[var(--ag-error)] bg-[color-mix(in_srgb,var(--ag-error)_8%,transparent)] p-2 text-sm">
          {target.message}
        </p>
        <p className="text-sm text-[var(--ag-muted)]">
          Arrows mean something here: each relation type has rules about what it can connect. Read
          about both parts:
        </p>
        {source && <Subject id={source.id} level={level} onOpen={open} compact />}
        {target2 && <Subject id={target2.id} level={level} onOpen={open} compact />}
      </div>
    );
  }

  if (!project) return null;
  const relation =
    selection.relations.length === 1
      ? project.model.relations.find((r) => r.id === selection.relations[0])
      : undefined;
  const element =
    selection.elements.length === 1 ? elementById(project, selection.elements[0]!) : undefined;
  if (relation) return <Subject id={relation.type} level={level} onOpen={open} />;
  if (element) return <Subject id={element.kind} level={level} onOpen={open} />;
  return (
    <p className="text-sm text-[var(--ag-muted)]">
      Select a shape or an arrow to learn what it is, when to use it, and the common mistakes.
    </p>
  );
}

/** Why a rule exists (its rationale), and the learning text behind it. */
function RuleView({
  id,
  level,
  onOpen,
}: {
  id: string;
  level: Level;
  onOpen: (id: string) => void;
}) {
  const rule = RULES.get(id);
  if (!rule) return <p className="text-sm">Unknown rule {id}.</p>;
  const packs = rule.packs.map((p) => RULE_PACKS.find((x) => x.id === p)?.name ?? p).join(', ');
  return (
    <article className="space-y-3" data-testid={`learn-rule-${id}`}>
      <BackButton />
      <div>
        <div className="text-xs uppercase tracking-wide text-[var(--ag-muted)]">
          <span style={{ color: SEVERITY_COLOR[rule.severity] }}>
            {severityLabel(rule.severity, level, false)}
          </span>{' '}
          · {rule.id} · {packs}
        </div>
        <h3 className="text-sm font-semibold">{rule.title}</h3>
      </div>
      <Markdown>{rule.rationale}</Markdown>
      {rule.replaces && level !== 'beginner' && (
        <p className="text-xs text-[var(--ag-muted)]">
          Replaces the generic rule {rule.replaces.join(', ')} for this stack.
        </p>
      )}
      {rule.learnId && (
        <div className="border-t border-[var(--ag-border)] pt-2">
          <Subject id={rule.learnId} level={level} onOpen={onOpen} compact />
          <button
            type="button"
            className="text-xs text-[var(--ag-accent)] hover:underline"
            onClick={() => onOpen(rule.learnId!)}
          >
            Read the full text
          </button>
        </div>
      )}
    </article>
  );
}

function BackButton() {
  return (
    <button
      type="button"
      className="text-xs text-[var(--ag-accent)] hover:underline"
      onClick={() => useUi.getState().set({ learnTarget: { kind: 'selection' } })}
    >
      ← Back to the selection
    </button>
  );
}

/** A concept, relation type or topic: catalog description, its text (if any), and related texts. */
function Subject({
  id,
  level,
  onOpen,
  back = false,
  compact = false,
}: {
  id: string;
  level: Level;
  onOpen: (id: string) => void;
  back?: boolean;
  compact?: boolean;
}) {
  const concept = catalog.concepts.get(id);
  const relationType = catalog.relationTypes.get(id);
  const doc = docFor(id);
  const related = relatedDocs(id);
  const title = doc?.title ?? concept?.name ?? relationType?.name ?? id;
  const description = concept?.docs ?? relationType?.docs;

  return (
    <article className="space-y-2" data-testid={`learn-${id}`}>
      {back && <BackButton />}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && !doc && <Markdown>{description}</Markdown>}
      {doc && <DocBody doc={doc} level={level} compact={compact} />}
      {!doc && !compact && (
        <p className="text-xs text-[var(--ag-muted)]">
          There is no full learning text for this yet.
        </p>
      )}
      {!compact && related.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--ag-muted)]">
            Related texts
          </h4>
          <ul className="space-y-1">
            {related.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="text-left text-sm text-[var(--ag-accent)] hover:underline"
                  onClick={() => onOpen(d.id)}
                >
                  {d.title}
                </button>
                <p className="text-xs text-[var(--ag-muted)]">{d.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function DocBody({ doc, level, compact }: { doc: LearningDoc; level: Level; compact: boolean }) {
  const view = textAt(doc, level);
  return (
    <div className="space-y-2">
      <p className="text-sm italic text-[var(--ag-muted)]">{doc.summary}</p>
      {!compact && (
        <>
          <Markdown>{view.text}</Markdown>
          {view.analogy && (
            <div className="rounded bg-[var(--ag-panel-2)] p-2">
              <h4 className="text-xs font-semibold">Analogy</h4>
              <Markdown>{view.analogy}</Markdown>
            </div>
          )}
          {view.lists.map((l) => (
            <div key={l.title}>
              <h4 className="text-xs font-semibold">{l.title}</h4>
              <Markdown>{l.items.map((i) => `- ${i}`).join('\n')}</Markdown>
            </div>
          ))}
          {view.examples.map((ex, i) => (
            <div key={i}>
              {ex.title && <h4 className="text-xs font-semibold">{ex.title}</h4>}
              <Markdown>{`\`\`\`${ex.language}\n${ex.code}\n\`\`\``}</Markdown>
            </div>
          ))}
          {view.references.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold">References</h4>
              <ul className="list-disc pl-4 text-sm">
                {view.references.map((r) => (
                  <li key={r.url}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--ag-accent)] hover:underline"
                    >
                      {r.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
