import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ArrowLeft,
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
  Redo2,
  Sun,
  Undo2,
} from 'lucide-react';
import type { Level } from '@archguide/core';
import { Canvas } from '../canvas/Canvas';
import { Inspector } from '../panels/Inspector';
import { CommandPalette, Legend, RelationPicker } from '../panels/Overlays';
import { Palette } from '../panels/Palette';
import { ProblemsButton, ProblemsPanel, SuppressDialog } from '../panels/Problems';
import { SaveTemplateDialog, TemplatePicker } from '../panels/Templates';
import { CompareBanner, SnapshotsDialog } from '../panels/Snapshots';
import { ExportDialog } from '../panels/ExportDialog';
import { TourEditor, TourPlayer, draftAndEditTour, playTour } from '../panels/Tours';
import {
  addAnchored,
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
import { useAutosave, useFolder, useScreen, useShortcuts } from '../hooks';
import type { Screen } from '../hooks';
import { folder } from '../persistence/folder';
import type { SaveStatus } from '../hooks';
import { loadProject } from '../persistence/db';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { LEVELS } from '../lib/learn';

export function Editor({ projectId }: { projectId: string }) {
  const project = useProject((s) => s.project);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadProject(projectId).then((p) => {
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
          Project “{projectId}” was not found in this browser.{' '}
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
  const status = useAutosave();
  const screen = useScreen();
  const panel = useUi((s) => s.panel);
  const desktop = screen === 'desktop';

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
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="relative min-h-0 flex-1">
              <Canvas />
              {screen !== 'phone' && <Legend />}
              <CompareBanner />
              <ConnectBanner />
              <TourPlayer />
              <TourEditor />
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
  const close = () => useUi.getState().set({ dialog: null });
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
  return null;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  error: 'Not saved',
};

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
    { label: 'Snapshots…', run: () => openDialog('snapshots') },
    { label: 'Export…', run: () => openDialog('export') },
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
  useUi((s) => `${s.theme}|${s.level}`);
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
        className="ml-2 flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
        onClick={() => useUi.getState().set({ dialog: 'templates' })}
        title="Insert a template"
      >
        <LayoutTemplate size={14} aria-hidden /> Templates
      </button>
      <button
        type="button"
        className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
        onClick={() => useUi.getState().set({ dialog: 'snapshots' })}
        title="Snapshots: save, compare and restore versions"
      >
        <History size={14} aria-hidden /> Snapshots
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
        className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)]"
        onClick={() => void tidyUp()}
        title="Tidy up: lay out the diagram automatically"
      >
        <Wand2 size={14} aria-hidden /> Tidy up
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
