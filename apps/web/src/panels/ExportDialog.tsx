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
    id: 'plan-md',
    name: 'Change-set plan',
    description:
      'plans/<id>.md: what a change set adds and changes, the invariants it must respect, the rule check and the tasks in build order.',
  },
  {
    id: 'speckit',
    name: 'Spec Kit',
    description: 'specs/<n>-<name>/spec.md, plan.md and tasks.md of a change set.',
  },
  {
    id: 'kiro',
    name: 'Kiro spec',
    description:
      '.kiro/specs/<name>/: requirements (WHEN … THE SYSTEM SHALL …), design and tasks of a change set.',
  },
  {
    id: 'openapi',
    name: 'OpenAPI skeleton',
    description:
      'OpenAPI 3.1 paths and schemas from the endpoints (of the selected route handler or contract).',
  },
  {
    id: 'sequence',
    name: 'Sequence diagram',
    description: 'A scenario view as a Mermaid sequenceDiagram.',
  },
  {
    id: 'likec4',
    name: 'LikeC4',
    description: 'The model, its kinds and views as LikeC4 source.',
  },
  {
    id: 'structurizr',
    name: 'Structurizr DSL',
    description: 'A C4 workspace: people, systems, containers and components.',
  },
  {
    id: 'plantuml',
    name: 'C4-PlantUML',
    description:
      'A C4 container diagram, or the components of the selected deployable, for PlantUML.',
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
  const baseline = useProject((s) => s.baseline)!;
  const activeChangeSet = useProject((s) => s.changeSetId);
  const viewId = useProject((s) => s.viewId);
  const selection = useProject((s) => s.selection);
  const changeSets = baseline.changeSets.filter(
    (c) => c.status === 'draft' || c.status === 'ready',
  );
  const [changeSetId, setChangeSetId] = useState(activeChangeSet ?? changeSets[0]?.id ?? '');
  const scenarios = project.views.filter((v) => v.kind === 'scenario');
  const [scenarioId, setScenarioId] = useState(
    scenarios.some((v) => v.id === viewId) ? viewId : (scenarios[0]?.id ?? ''),
  );
  const level = useUi((s) => s.level);
  const toast = useUi((s) => s.toast);
  const initial = useUi((s) => s.exportFormat);
  const [format, setFormat] = useState<Format>(initial ?? 'agent-md');
  const isPlan = format === 'plan-md' || format === 'speckit' || format === 'kiro';
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
    // OpenAPI: the selected route handler or contract is the scope.
    ...(format === 'openapi' && focus ? { focus } : {}),
    includeNotes,
    includeConcepts,
    level: readerLevel,
    conceptId,
    ...(isPlan && changeSetId ? { changeSetId } : {}),
    ...(format === 'sequence' && scenarioId ? { viewId: scenarioId } : {}),
  };
  const isImage = format === 'png' || format === 'svg';
  const result = useMemo(() => {
    if (isImage) return undefined;
    try {
      // Plans and the project file come from the saved project (with its change sets);
      // everything else shows what the canvas shows.
      const source = isPlan || format === 'json' ? baseline : project;
      return { files: exportProject(format, source, catalog, options).files };
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
    changeSetId,
    scenarioId,
    baseline,
  ]);
  const [shown, setShown] = useState(0);
  useEffect(() => setShown(0), [format, changeSetId]);

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

  const files = result && 'files' in result ? result.files! : [];
  const file = files[Math.min(shown, files.length - 1)];
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 max-sm:p-0"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        className="flex h-[min(720px,92vh)] w-[min(1040px,96vw)] overflow-hidden rounded-lg max-sm:h-dvh max-sm:w-screen max-sm:flex-col max-sm:rounded-none border border-[var(--ag-border)] bg-[var(--ag-panel)] shadow-2xl"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <nav
          className="w-60 shrink-0 overflow-y-auto border-r border-[var(--ag-border)] p-2 max-sm:max-h-[30%] max-sm:w-full max-sm:border-b max-sm:border-r-0"
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
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-3 border-b border-[var(--ag-border)] px-3 py-2 text-sm">
            {!isImage &&
              !isPlan &&
              !['json', 'concept-pack', 'sequence', 'openapi'].includes(format) && (
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
            {isPlan && (
              <label className="flex items-center gap-1">
                Change set
                <select
                  aria-label="Change set"
                  className={`${field} max-w-72`}
                  value={changeSetId}
                  onChange={(e) => setChangeSetId(e.target.value)}
                >
                  {changeSets.length === 0 && <option value="">No open change set</option>}
                  {changeSets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {format === 'sequence' && (
              <label className="flex items-center gap-1">
                Scenario
                <select
                  aria-label="Scenario"
                  className={`${field} max-w-72`}
                  value={scenarioId}
                  onChange={(e) => setScenarioId(e.target.value)}
                >
                  {scenarios.length === 0 && <option value="">No scenario view</option>}
                  {scenarios.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {files.length > 1 && (
              <label className="flex items-center gap-1">
                File
                <select
                  aria-label="File"
                  className={`${field} max-w-72`}
                  value={shown}
                  onChange={(e) => setShown(Number(e.target.value))}
                >
                  {files.map((f, i) => (
                    <option key={f.path} value={i}>
                      {f.path}
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
