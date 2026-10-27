import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ArrowLeft,
  History,
  Command,
  Download,
  LayoutTemplate,
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
import { dispatch, exportJson, redo, stampTemplate, tidyUp, undo } from '../actions';
import { useAutosave, useFolder, useShortcuts } from '../hooks';
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
      useUi.getState().set({ compare: null, dialog: null, activeFinding: null });
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

function EditorLoaded() {
  useShortcuts();
  const status = useAutosave();
  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <TopBar status={status} />
        <div className="flex min-h-0 flex-1">
          <Palette />
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="relative min-h-0 flex-1">
              <Canvas />
              <Legend />
              <CompareBanner />
            </main>
            <ProblemsPanel />
          </div>
          <Inspector />
        </div>
      </div>
      <RelationPicker />
      <CommandPalette />
      <SuppressDialog />
      <EditorDialogs />
    </ReactFlowProvider>
  );
}

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
  return null;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  error: 'Not saved',
};

function TopBar({ status }: { status: SaveStatus }) {
  const project = useProject((s) => s.project)!;
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const level = useUi((s) => s.level);
  const setLevel = useUi((s) => s.setLevel);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const iconButton = 'rounded p-1.5 hover:bg-[var(--ag-panel-2)] disabled:opacity-40';
  const folderState = useFolder();
  const inFolder = folderState.open && folder.isLinked(project.id);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--ag-border)] bg-[var(--ag-panel)] px-2">
      <a href="#/" className={iconButton} aria-label="Back to projects" title="Back to projects">
        <ArrowLeft size={16} />
      </a>
      <input
        aria-label="Project name"
        className="w-56 rounded border border-transparent bg-transparent px-1 font-semibold outline-none hover:border-[var(--ag-border)] focus:border-[var(--ag-accent)]"
        defaultValue={project.name}
        key={project.name}
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== project.name)
            dispatch([{ op: 'updateProject', patch: { name } }], { label: 'Rename project' });
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="text-xs text-[var(--ag-muted)]" data-testid="save-status" aria-live="polite">
        {STATUS_TEXT[status]}
        {inFolder && status === 'saved' && ` to folder ${folderState.name}`}
      </span>
      <div className="ml-2 flex">
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
          onClick={() => exportJson(project)}
          aria-label="Export JSON"
          title="Export JSON"
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
