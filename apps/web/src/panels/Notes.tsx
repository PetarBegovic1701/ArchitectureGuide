import { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Plus, Trash2 } from 'lucide-react';
import { uniqueId } from '@archguide/core';
import type { Decision, Id, Note, Project } from '@archguide/core';
import { canvasApi, dispatch } from '../actions';
import { elementById } from '../lib/model';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { inputClass } from './PropertyForm';

/** `@id` mentions of elements (Implementation.md §15). */
const MENTION = /@([a-z0-9]+(?:[.-][a-z0-9]+)*)/g;

export function mentionedIds(p: Project, ...texts: string[]): Id[] {
  const ids = new Set<Id>();
  for (const text of texts)
    for (const m of text.matchAll(MENTION)) if (elementById(p, m[1]!)) ids.add(m[1]!);
  return [...ids].sort();
}

function focusElement(id: Id) {
  useProject.getState().select({ elements: [id], relations: [] });
  canvasApi.focus?.([id]);
}

/** Markdown where `@id` mentions become links that select the element on the canvas. */
export function MentionMarkdown({ text }: { text: string }) {
  const project = useProject((s) => s.project);
  const withLinks = useMemo(
    () =>
      text.replace(MENTION, (match, id: string) => {
        const el = project && elementById(project, id);
        return el ? `[@${el.name}](#mention:${id})` : match;
      }),
    [text, project],
  );
  return (
    <div className="ag-md text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            href?.startsWith('#mention:') ? (
              <button
                type="button"
                className="font-medium text-[var(--ag-accent)] hover:underline"
                onClick={() => focusElement(href.slice('#mention:'.length))}
              >
                {children}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {withLinks}
      </ReactMarkdown>
    </div>
  );
}

/** A textarea that suggests elements after "@" and inserts `@id`. */
export function MentionTextarea({
  value,
  onChange,
  label,
  rows = 6,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rows?: number;
  placeholder?: string;
}) {
  const project = useProject((s) => s.project);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const matches = useMemo(() => {
    if (query === null || !project) return [];
    const q = query.toLowerCase();
    // Names that start with the query first, then IDs whose last part does, then the rest.
    const rank = (e: { id: string; name: string }) =>
      e.name.toLowerCase().startsWith(q) ? 0 : (e.id.split('.').at(-1) ?? '').startsWith(q) ? 1 : 2;
    return project.model.elements
      .filter((e) => e.id.includes(q) || e.name.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [query, project]);

  const update = (text: string, caret: number) => {
    onChange(text);
    const m = /@([a-z0-9.-]*)$/.exec(text.slice(0, caret));
    setQuery(m ? m[1]! : null);
    setIndex(0);
  };
  const insert = (id: Id) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([a-z0-9.-]*)$/, `@${id} `);
    const text = before + value.slice(caret);
    onChange(text);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        aria-label={label}
        rows={rows}
        className={`${inputClass} font-mono text-xs`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          if (matches.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            insert(matches[index]!.id);
          } else if (e.key === 'Escape') setQuery(null);
        }}
      />
      {matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mention an element"
          className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded border border-[var(--ag-border)] bg-[var(--ag-panel)] py-1 shadow-lg"
        >
          {matches.map((e, i) => (
            <li key={e.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                className={`block w-full px-2 py-1 text-left text-xs ${i === index ? 'bg-[var(--ag-panel-2)]' : ''}`}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  insert(e.id);
                }}
              >
                <span className="font-medium">{e.name}</span>{' '}
                <span className="text-[var(--ag-muted)]">@{e.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Notes -------------------------------------------------------------------------------

const GLOSSARY_TEMPLATE = 'Term: what it means in this project\nOrder: a confirmed cart\n';

/** Project notes: Markdown pages with `@id` mentions; a note titled "Glossary" is special. */
export function NotesTab() {
  const project = useProject((s) => s.project)!;
  const openId = useUi((s) => s.openNoteId);
  const note = project.notes.find((n) => n.id === openId);

  const create = (title: string, body = '') => {
    const id = uniqueId(
      title.toLowerCase() === 'glossary' ? 'glossary' : 'note',
      new Set(project.notes.map((n) => n.id)),
    );
    const n: Note = { id, title, body, linkedIds: [], updatedAt: new Date().toISOString() };
    if (dispatch([{ op: 'upsertNote', note: n }], { label: 'New note' }))
      useUi.getState().set({ openNoteId: id, noteEditing: true });
  };

  if (note) return <NoteEditor key={note.id} note={note} />;
  const hasGlossary = project.notes.some((n) => n.title.trim().toLowerCase() === 'glossary');
  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--ag-muted)]">
        Notes travel with the project and its exports. Type <code>@</code> to link an element.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="flex items-center gap-1 rounded bg-[var(--ag-accent)] px-2 py-1 text-xs text-[var(--ag-accent-text)]"
          onClick={() => create('New note')}
        >
          <Plus size={12} /> New note
        </button>
        {!hasGlossary && (
          <button
            type="button"
            className="rounded border border-[var(--ag-border)] px-2 py-1 text-xs"
            onClick={() => create('Glossary', GLOSSARY_TEMPLATE)}
          >
            Add a glossary
          </button>
        )}
      </div>
      <ul className="divide-y divide-[var(--ag-border)] rounded border border-[var(--ag-border)]">
        {[...project.notes]
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="block w-full px-2 py-1.5 text-left hover:bg-[var(--ag-panel-2)]"
                onClick={() => useUi.getState().set({ openNoteId: n.id, noteEditing: false })}
              >
                <span className="font-medium">{n.title}</span>
                <span className="block truncate text-xs text-[var(--ag-muted)]">
                  {n.body.split('\n')[0] || 'Empty'}
                </span>
              </button>
            </li>
          ))}
        {project.notes.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-[var(--ag-muted)]">No notes yet.</li>
        )}
      </ul>
    </div>
  );
}

function NoteEditor({ note }: { note: Note }) {
  const project = useProject((s) => s.project)!;
  const editing = useUi((s) => s.noteEditing);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const save = () => {
    const next: Note = {
      ...note,
      title: title.trim() || 'Untitled',
      body,
      linkedIds: mentionedIds(project, body),
      updatedAt: new Date().toISOString(),
    };
    if (next.title !== note.title || next.body !== note.body)
      dispatch([{ op: 'upsertNote', note: next }], { label: 'Edit note' });
    useUi.getState().set({ noteEditing: false });
  };
  return (
    <div className="space-y-2 text-sm" data-testid="note-editor">
      <BackTo label="All notes" onClick={() => useUi.getState().set({ openNoteId: null })} />
      {editing ? (
        <>
          <input
            aria-label="Note title"
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <MentionTextarea label="Note text" value={body} onChange={setBody} rows={12} />
          <p className="text-xs text-[var(--ag-muted)]">
            Markdown. Type @ to link an element.
            {title.trim().toLowerCase() === 'glossary' && ' One "term: definition" per line.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-[var(--ag-accent)] px-2 py-1 text-xs text-[var(--ag-accent-text)]"
              onClick={save}
            >
              Save
            </button>
            <DeleteButton
              label="Delete note"
              onClick={() => {
                if (dispatch([{ op: 'removeNote', id: note.id }], { label: 'Delete note' }))
                  useUi.getState().set({ openNoteId: null });
              }}
            />
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <h3 className="flex-1 font-semibold">{note.title}</h3>
            <button
              type="button"
              className="text-xs text-[var(--ag-accent)] hover:underline"
              onClick={() => useUi.getState().set({ noteEditing: true })}
            >
              Edit
            </button>
          </div>
          <MentionMarkdown text={note.body || '*Empty.*'} />
        </>
      )}
    </div>
  );
}

// --- Decisions ---------------------------------------------------------------------------

const STATUSES: Decision['status'][] = ['proposed', 'accepted', 'superseded', 'rejected'];

/** Architecture decision records (ADRs), linked to the elements they are about. */
export function DecisionsTab() {
  const project = useProject((s) => s.project)!;
  const openId = useUi((s) => s.openDecisionId);
  const selection = useProject((s) => s.selection);
  const decision = project.decisions.find((d) => d.id === openId);

  const create = () => {
    const taken = new Set(project.decisions.map((d) => d.id));
    let n = project.decisions.length + 1;
    while (taken.has(`adr-${String(n).padStart(3, '0')}`)) n++;
    const d: Decision = {
      id: `adr-${String(n).padStart(3, '0')}`,
      title: 'New decision',
      status: 'proposed',
      context: '',
      decision: '',
      consequences: '',
      linkedIds: [...selection.elements],
      date: new Date().toISOString(),
    };
    if (dispatch([{ op: 'upsertDecision', decision: d }], { label: 'New decision' }))
      useUi.getState().set({ openDecisionId: d.id });
  };

  if (decision) return <DecisionEditor key={decision.id} decision={decision} />;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--ag-muted)]">
        Record why the architecture is the way it is. Linked shapes show a badge; agents get the
        accepted and proposed decisions in their export.
      </p>
      <button
        type="button"
        className="flex items-center gap-1 rounded bg-[var(--ag-accent)] px-2 py-1 text-xs text-[var(--ag-accent-text)]"
        onClick={create}
      >
        <Plus size={12} /> New decision
        {selection.elements.length > 0 && ` (linked to ${selection.elements.length} selected)`}
      </button>
      <ul className="divide-y divide-[var(--ag-border)] rounded border border-[var(--ag-border)]">
        {[...project.decisions]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="block w-full px-2 py-1.5 text-left hover:bg-[var(--ag-panel-2)]"
                onClick={() => useUi.getState().set({ openDecisionId: d.id })}
              >
                <span className="text-xs text-[var(--ag-muted)]">{d.id}</span>{' '}
                <span className="font-medium">{d.title}</span>
                <span className="ml-1 rounded bg-[var(--ag-panel-2)] px-1 text-[10px]">
                  {d.status}
                </span>
              </button>
            </li>
          ))}
        {project.decisions.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-[var(--ag-muted)]">No decisions yet.</li>
        )}
      </ul>
    </div>
  );
}

function DecisionEditor({ decision: d }: { decision: Decision }) {
  const project = useProject((s) => s.project)!;
  const selection = useProject((s) => s.selection);
  const [draft, setDraft] = useState(d);
  const set = (patch: Partial<Decision>) => setDraft((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(d);
  const save = () => {
    const mentioned = mentionedIds(project, draft.context, draft.decision, draft.consequences);
    const linkedIds = [...new Set([...draft.linkedIds, ...mentioned])].sort();
    dispatch(
      [
        {
          op: 'upsertDecision',
          decision: { ...draft, title: draft.title.trim() || d.id, linkedIds },
        },
      ],
      {
        label: 'Edit decision',
      },
    );
  };
  return (
    <div className="space-y-2 text-sm" data-testid="decision-editor">
      <BackTo
        label="All decisions"
        onClick={() => useUi.getState().set({ openDecisionId: null })}
      />
      <div className="text-xs text-[var(--ag-muted)]">{d.id}</div>
      <input
        aria-label="Decision title"
        className={inputClass}
        value={draft.title}
        onChange={(e) => set({ title: e.target.value })}
      />
      <select
        aria-label="Decision status"
        className={inputClass}
        value={draft.status}
        onChange={(e) => set({ status: e.target.value as Decision['status'] })}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <Field label="Context: what forces the decision?">
        <MentionTextarea
          label="Context"
          value={draft.context}
          onChange={(v) => set({ context: v })}
          rows={3}
        />
      </Field>
      <Field label="Decision">
        <MentionTextarea
          label="Decision"
          value={draft.decision}
          onChange={(v) => set({ decision: v })}
          rows={3}
        />
      </Field>
      <Field label="Consequences">
        <MentionTextarea
          label="Consequences"
          value={draft.consequences}
          onChange={(v) => set({ consequences: v })}
          rows={3}
        />
      </Field>
      <Field label="Linked elements">
        <div className="flex flex-wrap gap-1">
          {draft.linkedIds.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1 rounded bg-[var(--ag-panel-2)] px-1.5 text-xs"
            >
              <button type="button" className="hover:underline" onClick={() => focusElement(id)}>
                {elementById(project, id)?.name ?? id}
              </button>
              <button
                type="button"
                aria-label={`Unlink ${id}`}
                onClick={() => set({ linkedIds: draft.linkedIds.filter((x) => x !== id) })}
              >
                ×
              </button>
            </span>
          ))}
          {selection.elements.some((id) => !draft.linkedIds.includes(id)) && (
            <button
              type="button"
              className="rounded border border-dashed border-[var(--ag-border)] px-1.5 text-xs"
              onClick={() =>
                set({ linkedIds: [...new Set([...draft.linkedIds, ...selection.elements])].sort() })
              }
            >
              + Link selection
            </button>
          )}
        </div>
      </Field>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!dirty}
          className="rounded bg-[var(--ag-accent)] px-2 py-1 text-xs text-[var(--ag-accent-text)] disabled:opacity-40"
          onClick={save}
        >
          Save
        </button>
        <DeleteButton
          label="Delete decision"
          onClick={() => {
            if (dispatch([{ op: 'removeDecision', id: d.id }], { label: 'Delete decision' }))
              useUi.getState().set({ openDecisionId: null });
          }}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs text-[var(--ag-muted)]">{label}</div>
      {children}
    </div>
  );
}

function BackTo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-xs text-[var(--ag-accent)] hover:underline"
      onClick={onClick}
    >
      ← {label}
    </button>
  );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--ag-error)] hover:bg-[var(--ag-panel-2)]"
      onClick={onClick}
    >
      <Trash2 size={12} /> {label}
    </button>
  );
}
