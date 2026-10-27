import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import { allTemplates, conceptsUsed, computeFacts, exportProject } from '@archguide/core';
import type { ExportFormat, ExportOptions, Level } from '@archguide/core';
import { catalog, docs } from '../lib/catalog';
import { elementById } from '../lib/model';
import { LEVELS } from '../lib/learn';
import { canvasApi, download } from '../actions';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';

type Format = ExportFormat | 'png' | 'svg';

const FORMATS: { id: Format; name: string; description: string }[] = [
  {
    id: 'agent-md',
    name: 'Agent Markdown',
    description:
      'ARCHITECTURE.md for AI agents and reviewers: elements, relations, data ownership, rules (invariants), known issues, decisions.',
  },
  {
    id: 'agents-snippet',
    name: 'AGENTS.md snippet',
    description:
      'A short block for AGENTS.md or CLAUDE.md that points agents to the architecture and its rules.',
  },
  { id: 'agent-yaml', name: 'Agent YAML', description: 'The same facts in a compact YAML file.' },
  {
    id: 'onboarding-md',
    name: 'Onboarding pack',
    description:
      'ONBOARDING.md for people joining the project: the big picture, the tour, rules of the road, and the concepts it uses at your level.',
  },
  {
    id: 'concept-pack',
    name: 'Concept pack',
    description:
      'One pattern or concept, with its template, invariants, example and walkthrough, to apply elsewhere.',
  },
  {
    id: 'mermaid',
    name: 'Mermaid',
    description: 'A flowchart for GitHub, GitLab or Notion Markdown.',
  },
  {
    id: 'dbml',
    name: 'DBML',
    description: 'PostgreSQL tables with columns, for dbdiagram.io and similar tools.',
  },
  {
    id: 'json',
    name: 'Project JSON',
    description: 'The full project file; import it again or keep it in Git.',
  },
  { id: 'png', name: 'PNG image', description: 'A picture of the whole diagram.' },
  { id: 'svg', name: 'SVG image', description: 'A scalable picture of the whole diagram.' },
];

const field =
  'rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-1.5 py-0.5 text-sm outline-none focus:border-[var(--ag-accent)]';

/** Export with options, a live preview, copy and download (Implementation.md §18). */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project)!;
  const selection = useProject((s) => s.selection);
  const level = useUi((s) => s.level);
  const toast = useUi((s) => s.toast);
  const [format, setFormat] = useState<Format>('agent-md');
  const [focusOn, setFocusOn] = useState(false);
  const [depth, setDepth] = useState(1);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeConcepts, setIncludeConcepts] = useState(level !== 'senior');
  const [readerLevel, setReaderLevel] = useState<Level>(level);
  const [image, setImage] = useState<string | null>(null);

  const focus = selection.elements.length === 1 ? selection.elements[0] : undefined;
  const conceptChoices = useMemo(() => {
    const templates = allTemplates(catalog).map((t) => ({
      id: t.id,
      label: `Template ${t.code}: ${t.name}`,
    }));
    const patterns = [...docs.values()]
      .filter((d) => d.kind === 'pattern' || d.kind === 'topic')
      .map((d) => ({ id: d.id, label: d.title }));
    const used = conceptsUsed(computeFacts(project, catalog))
      .filter((c) => c.kind === 'concept')
      .map((c) => ({ id: c.id, label: `Concept: ${c.name}` }));
    return [...templates, ...patterns, ...used];
  }, [project]);
  const [conceptId, setConceptId] = useState(
    project.derivedFrom?.[0]?.templateId ?? conceptChoices[0]?.id ?? '',
  );

  const options: ExportOptions = {
    ...(focusOn && focus ? { focus, depth } : {}),
    includeNotes,
    includeConcepts,
    level: readerLevel,
    conceptId,
  };
  const isImage = format === 'png' || format === 'svg';
  const result = useMemo(() => {
    if (isImage) return undefined;
    try {
      return { files: exportProject(format, project, catalog, options).files };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [
    format,
    project,
    focusOn,
    focus,
    depth,
    includeNotes,
    includeConcepts,
    readerLevel,
    conceptId,
  ]);

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    setImage(null);
    canvasApi
      .exportImage?.(format)
      .then((url) => !cancelled && setImage(url))
      .catch((error: Error) =>
        toast({ tone: 'error', message: `Image export failed: ${error.message}` }),
      );
    return () => {
      cancelled = true;
    };
  }, [format, isImage, toast]);

  const file = result && 'files' in result ? result.files![0] : undefined;
  const copy = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(file.content);
    toast({ tone: 'success', message: `Copied ${file.path} to the clipboard.` });
  };
  const save = () => {
    if (isImage && image) {
      const a = document.createElement('a');
      a.href = image;
      a.download = `${project.id}.${format}`;
      a.click();
    } else if (file) download(file.path.split('/').pop()!, file.content, file.mime);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        className="flex h-[min(720px,92vh)] w-[min(1040px,96vw)] overflow-hidden rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-2xl"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <nav
          className="w-60 shrink-0 overflow-y-auto border-r border-[var(--ag-border)] p-2"
          aria-label="Formats"
        >
          <ul role="listbox" aria-label="Export format">
            {FORMATS.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={f.id === format}
                  className={`w-full rounded px-2 py-1.5 text-left ${f.id === format ? 'bg-[var(--ag-panel-2)]' : 'hover:bg-[var(--ag-panel-2)]'}`}
                  onClick={() => setFormat(f.id)}
                >
                  <span className="block text-sm font-medium">{f.name}</span>
                  <span className="block text-xs text-[var(--ag-muted)]">{f.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-3 border-b border-[var(--ag-border)] px-3 py-2 text-sm">
            {!isImage && format !== 'json' && format !== 'concept-pack' && (
              <label
                className="flex items-center gap-1"
                title={focus ? '' : 'Select one shape first'}
              >
                <input
                  type="checkbox"
                  checked={focusOn && !!focus}
                  disabled={!focus}
                  onChange={(e) => setFocusOn(e.target.checked)}
                />
                Only around{' '}
                {focus ? (elementById(project, focus)?.name ?? focus) : 'the selected shape'}
              </label>
            )}
            {focusOn && focus && !isImage && (
              <label className="flex items-center gap-1">
                Depth
                <select
                  className={field}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                >
                  {[1, 2, 3].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {format === 'agent-md' && (
              <>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={includeNotes}
                    onChange={(e) => setIncludeNotes(e.target.checked)}
                  />
                  Notes
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={includeConcepts}
                    onChange={(e) => setIncludeConcepts(e.target.checked)}
                  />
                  Concepts
                </label>
              </>
            )}
            {format === 'onboarding-md' && (
              <label className="flex items-center gap-1">
                Reader level
                <select
                  className={field}
                  value={readerLevel}
                  onChange={(e) => setReaderLevel(e.target.value as Level)}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {format === 'concept-pack' && (
              <label className="flex items-center gap-1">
                About
                <select
                  aria-label="Concept"
                  className={`${field} max-w-72`}
                  value={conceptId}
                  onChange={(e) => setConceptId(e.target.value)}
                >
                  {conceptChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="ml-auto rounded p-1 hover:bg-[var(--ag-panel-2)]"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto bg-[var(--ag-bg)] p-3">
            {isImage ? (
              image ? (
                <img
                  src={image}
                  alt="The exported diagram"
                  className="max-w-full rounded border border-[var(--ag-border)]"
                />
              ) : (
                <p className="text-sm text-[var(--ag-muted)]">Rendering the diagram…</p>
              )
            ) : result && 'error' in result ? (
              <p className="text-sm text-[var(--ag-error)]">{result.error}</p>
            ) : (
              <pre
                className="whitespace-pre-wrap break-words font-mono text-xs"
                data-testid="export-preview"
              >
                {file?.content}
              </pre>
            )}
          </div>
          <footer className="flex items-center gap-2 border-t border-[var(--ag-border)] px-3 py-2">
            <span className="text-xs text-[var(--ag-muted)]">
              {isImage ? `${project.id}.${format}` : file?.path}
            </span>
            {!isImage && (
              <button
                type="button"
                className="ml-auto flex items-center gap-1 rounded border border-[var(--ag-border)] px-3 py-1 text-sm"
                disabled={!file}
                onClick={() => void copy()}
              >
                <Copy size={14} /> Copy
              </button>
            )}
            <button
              type="button"
              className={`${isImage ? 'ml-auto ' : ''}flex items-center gap-1 rounded bg-[var(--ag-accent)] px-3 py-1 text-sm text-[var(--ag-accent-text)] disabled:opacity-40`}
              disabled={isImage ? !image : !file}
              onClick={save}
            >
              <Download size={14} /> Download
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}
