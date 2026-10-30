import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ArrowLeft,
  GitBranch,
  History,
  Command,
  MoreHorizontal,
  Shapes,
  SlidersHorizontal,
  Download,
  LayoutTemplate,
  Map as MapIcon,
  StickyNote,
  Wand2,
  Moon,
  ScanSearch,
  Layers,
  Redo2,
  Sun,
  Undo2,
  X,
} from 'lucide-react';
import { LAB_CONTROLS } from '@archguide/core';
import type { LabControl, Level } from '@archguide/core';
import { ConcurrencyLab } from '../panels/ConcurrencyLab';
import { LessonPlayer, useActiveLesson } from '../panels/LessonPlayer';
import { Canvas } from '../canvas/Canvas';
import { Inspector } from '../panels/Inspector';
import { CommandPalette, Legend, OwnershipLegend, RelationPicker } from '../panels/Overlays';
import { AnalysisDialog } from '../panels/Analysis';
import { ChangeSetBanner, ChangeSetsDialog } from '../panels/ChangeSets';
import {
  ApiDialog,
  CanvasChips,
  DocsButton,
  FiltersButton,
  ScenarioBar,
  projectHasDocs,
} from '../panels/Views';
import { Palette } from '../panels/Palette';
import { ProblemsButton, ProblemsPanel, SuppressDialog } from '../panels/Problems';
import { SaveTemplateDialog, TemplatePicker } from '../panels/Templates';
import { CompareBanner, SnapshotsDialog } from '../panels/Snapshots';
import { ExportDialog } from '../panels/ExportDialog';
import { TourEditor, TourPlayer, draftAndEditTour, playTour } from '../panels/Tours';
import {
  addAnchored,
  createDatabaseView,
  createView,
  drillInto,
  addRegion,
  addSticky,
  dispatch,
  redo,
  stampTemplate,
  tidyUp,
  undo,
} from '../actions';
import { Menu } from '../panels/Menu';
import type { MenuItem } from '../panels/Menu';
import { BottomSheet, BottomToolbar, ConnectBanner, ContextMenu, Drawer } from '../panels/Mobile';
import {
  currentSync,
  useAutosave,
  useFolder,
  useScreen,
  useServeSync,
  useShortcuts,
} from '../hooks';
import type { Screen } from '../hooks';
import { folder } from '../persistence/folder';
import type { SaveStatus } from '../hooks';
import { loadProject } from '../persistence/db';
import { isServeMode, isServed, loadServeProject, markBrowserOnly } from '../persistence/serve';
import type { SyncState } from '../persistence/serve';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { LEVELS } from '../lib/learn';

/**
 * Serve mode loads from the server; a project that is not there but in this browser (a
 * lesson's practice project) opens as a browser project, saved locally and not synced.
 */
async function loadEither(projectId: string) {
  if (!isServeMode()) return loadProject(projectId);
  const served = await loadServeProject(projectId);
  if (served) return served;
  const local = await loadProject(projectId);
  if (local) markBrowserOnly(projectId);
  return local;
}

export function Editor({ projectId }: { projectId: string }) {
  const project = useProject((s) => s.project);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadEither(projectId).then((p) => {
      if (cancelled) return;
      if (p) useProject.getState().load(p);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
      useProject.getState().unload();
      useUi
        .getState()
        .set({ compare: null, dialog: null, activeFinding: null, tour: null, editingTour: null });
    };
  }, [projectId]);

  if (missing) {
    return (
      <main className="p-10">
        <p>
          Project “{projectId}” was not found{' '}
          {isServeMode() ? 'in the workspace' : 'in this browser'}.{' '}
          <a className="text-[var(--ag-accent)] underline" href="#/">
            Back to projects
          </a>
        </p>
      </main>
    );
  }
  if (!project || project.id !== projectId)
    return <p className="p-10 text-[var(--ag-muted)]">Loading…</p>;
  return <EditorLoaded />;
}

/**
 * Desktop: palette | canvas + problems | inspector. Tablet: the palette and inspector
 * become drawers. Phone: a bottom toolbar opens them as bottom sheets (§13.10).
 */
function EditorLoaded() {
  useShortcuts();
  const saved = useAutosave();
  const sync = useServeSync(useProject.getState().project!.id);
  const status = sync ? syncStatus(sync) : saved;
  const screen = useScreen();
  const panel = useUi((s) => s.panel);
  const desktop = screen === 'desktop';
  const projectId = useProject((s) => s.project!.id);
  const lesson = useActiveLesson(projectId);

  // Leaving a small screen closes its drawer or sheet.
  useEffect(() => {
    if (desktop) useUi.getState().set({ panel: null, multiSelect: false });
  }, [desktop]);

  const overlay =
    screen === 'tablet' ? (
      panel === 'palette' ? (
        <Drawer side="left" label="Shapes">
          <Palette variant="sheet" />
        </Drawer>
      ) : panel === 'inspector' ? (
        <Drawer side="right" label="Inspector">
          <Inspector variant="sheet" />
        </Drawer>
      ) : null
    ) : screen === 'phone' && panel ? (
      <BottomSheet label={SHEET_LABEL[panel]}>
        {panel === 'palette' ? (
          <Palette variant="sheet" />
        ) : panel === 'inspector' ? (
          <Inspector variant="sheet" />
        ) : (
          <ProblemsPanel variant="sheet" />
        )}
      </BottomSheet>
    ) : null;

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col overflow-hidden">
        <TopBar status={status} screen={screen} />
        <div className="relative flex min-h-0 flex-1">
          {desktop && <Palette />}
          {desktop && lesson && <LessonPlayer key={lesson.id} lesson={lesson} variant="dock" />}
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="relative min-h-0 flex-1">
              <Canvas />
              {screen !== 'phone' && <Legend />}
              <CompareBanner />
              <ChangeSetBanner />
              <CanvasChips />
              <ScenarioBar />
              <OwnershipLegend />
              {sync?.conflict && <ConflictBanner sync={sync} />}
              <ConnectBanner />
              <TourPlayer />
              <TourEditor />
              {lesson && !desktop && (
                <LessonPlayer
                  key={lesson.id}
                  lesson={lesson}
                  variant={screen === 'phone' ? 'sheet' : 'float'}
                />
              )}
            </main>
            {screen !== 'phone' && <ProblemsPanel />}
          </div>
          {desktop && <Inspector />}
          {overlay}
        </div>
        {screen === 'phone' && <BottomToolbar />}
      </div>
      <RelationPicker />
      <CommandPalette />
      <SuppressDialog />
      <ContextMenu smallScreen={!desktop} />
      <EditorDialogs />
    </ReactFlowProvider>
  );
}

const SHEET_LABEL = { palette: 'Shapes', inspector: 'Inspector', problems: 'Problems' } as const;

function EditorDialogs() {
  const dialog = useUi((s) => s.dialog);
  const close = () => useUi.getState().set({ dialog: null, exportFormat: null });
  if (dialog === 'templates')
    return (
      <TemplatePicker
        mode="stamp"
        onClose={close}
        onUse={(template, params) => {
          close();
          stampTemplate(template, params);
        }}
      />
    );
  if (dialog === 'save-template') return <SaveTemplateDialog onClose={close} />;
  if (dialog === 'snapshots') return <SnapshotsDialog onClose={close} />;
  if (dialog === 'export') return <ExportDialog onClose={close} />;
  if (dialog === 'analysis') return <AnalysisDialog onClose={close} />;
  if (dialog === 'changesets') return <ChangeSetsDialog onClose={close} />;
  if (dialog === 'api') return <ApiDialog onClose={close} />;
  if (dialog === 'lab') return <LabDialog onClose={close} />;
  return null;
}

/** The concurrency lab for one `writes` relation; "Use this" sets its concurrencyControl. */
function LabDialog({ onClose }: { onClose: () => void }) {
  const project = useProject((s) => s.project)!;
  const id = useUi((s) => s.labRelation);
  const relation = project.model.relations.find((r) => r.id === id);
  const control = relation?.properties?.concurrencyControl;
  const name = (eid: string) => project.model.elements.find((e) => e.id === eid)?.name ?? eid;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 max-sm:p-0"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Concurrency lab"
        className="max-h-[92vh] w-[min(1000px,96vw)] overflow-y-auto rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-4 shadow-2xl max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:rounded-none"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <header className="mb-2 flex items-center gap-2">
          <h2 className="flex-1 font-semibold">
            Concurrency lab
            {relation && (
              <span className="font-normal text-[var(--ag-muted)]">
                {' '}
                · {name(relation.sourceId)} writes {name(relation.targetId)}
              </span>
            )}
          </h2>
          <button
            type="button"
            className="ag-touch rounded p-1 hover:bg-[var(--ag-panel-2)]"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <ConcurrencyLab
          initialControl={
            LAB_CONTROLS.some((c) => c.id === control) ? (control as LabControl) : 'none'
          }
          applyLabel={relation ? 'Use on this arrow' : undefined}
          onApply={
            relation
              ? (c) => {
                  dispatch(
                    [
                      {
                        op: 'updateRelation',
                        id: relation.id,
                        patch: {
                          properties: { ...(relation.properties ?? {}), concurrencyControl: c },
                        },
                      },
                    ],
                    { label: 'Concurrency control' },
                  );
                  onClose();
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  error: 'Not saved',
  connecting: 'Connecting…',
  offline: 'Offline: reconnecting…',
  conflict: 'Conflict',
};

/** Serve mode: the server saves; the status follows the sync (§14.3). */
function syncStatus(sync: SyncState): SaveStatus {
  if (sync.conflict) return 'conflict';
  if (sync.status !== 'live') return sync.status;
  return sync.pending > 0 ? 'saving' : 'saved';
}

const ORIGIN_TEXT = {
  mcp: 'an agent (MCP)',
  cli: 'the CLI',
  client: 'another tab',
  file: 'a file change',
};

/** "The file changed outside the app. Reapply your changes / Discard" (§14.5). */
function ConflictBanner({ sync }: { sync: SyncState }) {
  const count = sync.conflict?.ops.length ?? 0;
  return (
    <div
      role="alertdialog"
      aria-label="Conflict"
      className="absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-[var(--ag-warning)] bg-[var(--ag-panel)] px-3 py-2 text-sm shadow-lg"
    >
      <span>
        The file changed outside the app. You have {count} unsaved change{count === 1 ? '' : 's'}.
      </span>
      <button
        type="button"
        className="rounded bg-[var(--ag-accent)] px-2 py-1 text-xs font-semibold text-[var(--ag-accent-text)]"
        onClick={() => currentSync()?.reapply()}
      >
        Reapply your changes
      </button>
      <button
        type="button"
        className="rounded border border-[var(--ag-border)] px-2 py-1 text-xs font-semibold"
        onClick={() => currentSync()?.discard()}
      >
        Discard
      </button>
    </div>
  );
}

const iconButton = 'ag-touch rounded p-1.5 hover:bg-[var(--ag-panel-2)] disabled:opacity-40';

function ProjectName({ className }: { className: string }) {
  const project = useProject((s) => s.project)!;
  return (
    <input
      aria-label="Project name"
      className={`${className} min-w-0 rounded border border-transparent bg-transparent px-1 font-semibold outline-none hover:border-[var(--ag-border)] focus:border-[var(--ag-accent)]`}
      defaultValue={project.name}
      key={project.name}
      onBlur={(e) => {
        const name = e.target.value.trim();
        if (name && name !== project.name)
          dispatch([{ op: 'updateProject', patch: { name } }], { label: 'Rename project' });
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Serve mode: who changed the model last, from outside this tab. */
function LiveNote() {
  const [sync, setSync] = useState(() => currentSync()?.state ?? null);
  useEffect(() => currentSync()?.subscribe(() => setSync(currentSync()?.state ?? null)), []);
  return (
    <span data-testid="live-note">
      {' · live'}
      {sync?.lastRemote && ` · last change by ${ORIGIN_TEXT[sync.lastRemote.origin]}`}
    </span>
  );
}

function SaveStatusText({ status, short = false }: { status: SaveStatus; short?: boolean }) {
  const project = useProject((s) => s.project)!;
  const folderState = useFolder();
  const inFolder = folderState.open && folder.isLinked(project.id);
  return (
    <span
      className="shrink-0 text-xs text-[var(--ag-muted)]"
      data-testid="save-status"
      aria-live="polite"
    >
      {STATUS_TEXT[status]}
      {!short && inFolder && status === 'saved' && ` to folder ${folderState.name}`}
      {!short && isServed(project.id) && status === 'saved' && <LiveNote />}
    </span>
  );
}

function UndoRedo() {
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  return (
    <div className="flex shrink-0">
      <button
        type="button"
        className={iconButton}
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        className={iconButton}
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 size={16} />
      </button>
    </div>
  );
}

const openDialog = (dialog: 'templates' | 'snapshots' | 'export') =>
  useUi.getState().set({ dialog, panel: null });

/** Everything the desktop top bar shows, as one menu for small screens. */
function overflowItems(): MenuItem[] {
  const ui = useUi.getState();
  const tours = useProject.getState().project?.tours ?? [];
  return [
    { label: 'Templates…', run: () => openDialog('templates') },
    // Serve mode: the files are in git, which keeps the history.
    ...(isServed(useProject.getState().project?.id)
      ? []
      : [{ label: 'Snapshots…', run: () => openDialog('snapshots') }]),
    { label: 'Export…', run: () => openDialog('export') },
    { label: 'Analysis…', run: () => ui.set({ dialog: 'analysis', panel: null }) },
    { label: 'Change sets…', run: () => ui.set({ dialog: 'changesets', panel: null }) },
    ...viewItems(),
    ...tours.map((t) => ({ label: `Play tour: ${t.title}`, run: () => playTour(t.id) })),
    ...tours.map((t) => ({
      label: `Edit tour: ${t.title}`,
      run: () => ui.set({ editingTour: t.id, tour: null }),
    })),
    { label: 'Draft a tour from the diagram', run: draftAndEditTour },
    { label: 'Add a sticky note', run: addSticky },
    { label: 'Add a region around the selection', run: addRegion },
    { label: 'Add a callout on the selection', run: () => addAnchored('callout') },
    { label: 'Add a comment', run: () => addAnchored('comment') },
    { label: 'Tidy up the layout', run: () => void tidyUp() },
    ...(projectHasDocs(useProject.getState().project)
      ? [
          {
            label: ui.showDocs ? 'Hide the documentation' : 'Show the documentation',
            run: () => ui.set({ showDocs: !ui.showDocs }),
          },
        ]
      : []),
    { label: 'Command palette…', run: () => ui.set({ commandOpen: true }) },
    {
      label: ui.theme === 'dark' ? 'Light mode' : 'Dark mode',
      run: () => ui.setTheme(ui.theme === 'dark' ? 'light' : 'dark'),
    },
    ...LEVELS.map((l) => ({
      label: `Level: ${l}${ui.level === l ? ' ✓' : ''}`,
      run: () => ui.setLevel(l),
    })),
  ];
}

/** Tablet and phone top bar: the essentials, the rest in a "More" menu. */
function CompactTopBar({ status, screen }: { status: SaveStatus; screen: Screen }) {
  const panel = useUi((s) => s.panel);
  // Re-read the menu items when what they show changes.
  useUi((s) => `${s.theme}|${s.level}|${s.showDocs}`);
  useProject((s) => s.project?.tours);
  const toggle = (p: 'palette' | 'inspector') =>
    useUi.getState().set({ panel: panel === p ? null : p });
  const tablet = screen === 'tablet';
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--ag-border)] bg-[var(--ag-panel)] px-1">
      <a href="#/" className={iconButton} aria-label="Back to projects" title="Back to projects">
        <ArrowLeft size={16} />
      </a>
      {tablet && (
        <button
          type="button"
          className={iconButton}
          aria-label="Shapes"
          aria-pressed={panel === 'palette'}
          title="Shapes"
          onClick={() => toggle('palette')}
        >
          <Shapes size={16} />
        </button>
      )}
      <ProjectName className={tablet ? 'w-48' : 'flex-1'} />
      <SaveStatusText status={status} short />
      <UndoRedo />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {tablet && <ProblemsButton />}
        {tablet && (
          <button
            type="button"
            className={iconButton}
            aria-label="Inspector"
            aria-pressed={panel === 'inspector'}
            title="Inspector"
            onClick={() => toggle('inspector')}
          >
            <SlidersHorizontal size={16} />
          </button>
        )}
        <Menu
          label="More"
          iconOnly
          align="right"
          icon={<MoreHorizontal size={16} aria-hidden />}
          items={overflowItems()}
        />
      </div>
    </header>
  );
}

function TopBar({ status, screen }: { status: SaveStatus; screen: Screen }) {
  const project = useProject((s) => s.project)!;
  const level = useUi((s) => s.level);
  const setLevel = useUi((s) => s.setLevel);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  if (screen !== 'desktop') return <CompactTopBar status={status} screen={screen} />;
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--ag-border)] bg-[var(--ag-panel)] px-2">
      <a href="#/" className={iconButton} aria-label="Back to projects" title="Back to projects">
        <ArrowLeft size={16} />
      </a>
      <ProjectName className="w-56" />
      <SaveStatusText status={status} />
      <div className="ml-2">
        <UndoRedo />
      </div>
      <button
        type="button"
        className="ml-2 flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
        onClick={() => useUi.getState().set({ dialog: 'templates' })}
        title="Insert a template"
      >
        <LayoutTemplate size={14} aria-hidden /> Templates
      </button>
      {!isServed(project.id) && (
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
          onClick={() => useUi.getState().set({ dialog: 'snapshots' })}
          title="Snapshots: save, compare and restore versions"
        >
          <History size={14} aria-hidden /> <span className="max-2xl:sr-only">Snapshots</span>
        </button>
      )}
      <ViewsMenu />
      <FiltersButton />
      <DocsButton />
      <button
        type="button"
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
        onClick={() => useUi.getState().set({ dialog: 'analysis' })}
        title="Analysis: review what the analyzer found in the code"
      >
        <ScanSearch size={14} aria-hidden /> <span className="max-2xl:sr-only">Analysis</span>
      </button>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
        onClick={() => useUi.getState().set({ dialog: 'changesets' })}
        title="Change sets: plan a feature on top of the model"
      >
        <GitBranch size={14} aria-hidden /> Change sets
      </button>
      <Menu
        label="Tours"
        icon={<MapIcon size={14} aria-hidden />}
        items={[
          ...project.tours.map((t) => ({ label: `Play: ${t.title}`, run: () => playTour(t.id) })),
          ...project.tours.map((t) => ({
            label: `Edit: ${t.title}`,
            run: () => useUi.getState().set({ editingTour: t.id, tour: null }),
          })),
          { label: 'Draft a tour from the diagram', run: draftAndEditTour },
        ]}
      />
      <Menu
        label="Annotate"
        icon={<StickyNote size={14} aria-hidden />}
        items={[
          { label: 'Sticky note', run: addSticky },
          { label: 'Region (around the selection)', run: addRegion },
          { label: 'Callout on the selection', run: () => addAnchored('callout') },
          { label: 'Comment', run: () => addAnchored('comment') },
        ]}
      />
      <button
        type="button"
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
        onClick={() => void tidyUp()}
        title="Tidy up: lay out the diagram automatically"
      >
        <Wand2 size={14} aria-hidden /> <span className="max-2xl:sr-only">Tidy up</span>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <ProblemsButton />
        <div
          className="flex rounded border border-[var(--ag-border)] text-xs"
          role="group"
          aria-label="Experience level"
        >
          {LEVELS.map((l: Level) => (
            <button
              key={l}
              type="button"
              aria-pressed={level === l}
              onClick={() => setLevel(l)}
              className={`px-2 py-1 capitalize ${level === l ? 'bg-[var(--ag-accent)] text-[var(--ag-accent-text)]' : ''}`}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={iconButton}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle dark mode"
          title="Toggle dark mode"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          className={iconButton}
          onClick={() => useUi.getState().set({ dialog: 'export' })}
          aria-label="Export"
          title="Export: agent Markdown, Mermaid, DBML, image … (Ctrl+E)"
        >
          <Download size={16} />
        </button>
        <button
          type="button"
          className={iconButton}
          onClick={() => useUi.getState().set({ commandOpen: true })}
          aria-label="Command palette"
          title="Command palette (Ctrl+K)"
        >
          <Command size={16} />
        </button>
      </div>
    </header>
  );
}

/** Views of the project, new generated views, and the ownership colors. */
function viewItems(): MenuItem[] {
  const { project, viewId, selection } = useProject.getState();
  const ui = useUi.getState();
  const selected =
    selection.elements.length === 1
      ? project?.model.elements.find((e) => e.id === selection.elements[0])
      : undefined;
  return [
    ...(project?.views ?? []).map((v) => ({
      label: `View: ${v.name}${v.id === viewId ? ' ✓' : ''}`,
      run: () => useProject.getState().setView(v.id),
    })),
    { label: 'Create context view', run: () => void createView('context') },
    { label: 'Create container view', run: () => void createView('container') },
    ...(selected
      ? [
          {
            label: `Open the inside of ${selected.name}`,
            run: () =>
              drillInto(selected.id) ||
              useUi.getState().toast({
                tone: 'info',
                message: 'Only deployables and databases have an inside view.',
              }),
          },
        ]
      : []),
    { label: 'Create database view', run: createDatabaseView },
    { label: 'New scenario from this view', run: () => void createView('scenario') },
    { label: 'API view (endpoints)…', run: () => ui.set({ dialog: 'api', panel: null }) },
    {
      label: ui.ownership ? 'Hide ownership colors' : 'Show ownership colors',
      run: () => ui.set({ ownership: !ui.ownership }),
    },
  ];
}

function ViewsMenu() {
  // Re-read the items when the views, the active view or the toggle change.
  useProject(
    (s) => `${s.viewId}|${s.project?.views.map((v) => v.id).join()}|${s.selection.elements.join()}`,
  );
  useUi((s) => s.ownership);
  return <Menu label="Views" icon={<Layers size={14} aria-hidden />} items={viewItems()} />;
}
