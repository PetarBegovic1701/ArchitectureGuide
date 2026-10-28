import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  cancelConnectMode,
  copy,
  deleteSelection,
  duplicate,
  paste,
  redo,
  startConnectMode,
  undo,
} from './actions';
import { saveProject } from './persistence/db';
import { folder } from './persistence/folder';
import { ServeSync, isServed } from './persistence/serve';
import type { SyncState } from './persistence/serve';
import { onLocalChanges, useProject } from './store/project';
import { useUi } from './store/ui';

export type Route =
  | { page: 'workspace' }
  | { page: 'editor'; projectId: string }
  | { page: 'gallery' }
  | { page: 'learn' }
  | { page: 'library'; query?: string }
  | { page: 'doc'; id: string }
  | { page: 'lab' };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const editor = /^\/p\/([^/]+)/.exec(path);
  if (editor) return { page: 'editor', projectId: decodeURIComponent(editor[1]!) };
  if (path.startsWith('/gallery')) return { page: 'gallery' };
  const doc = /^\/library\/([^/?]+)/.exec(path);
  if (doc) return { page: 'doc', id: decodeURIComponent(doc[1]!) };
  if (path.startsWith('/library')) {
    const query = new URLSearchParams(path.split('?')[1] ?? '').get('q');
    return query ? { page: 'library', query } : { page: 'library' };
  }
  if (path.startsWith('/learn')) return { page: 'learn' };
  if (path.startsWith('/lab')) return { page: 'lab' };
  return { page: 'workspace' };
}

/** The hash for a route (Phase 6 adds the learning pages, Implementation.md §17.7). */
export function hrefFor(route: Route): string {
  switch (route.page) {
    case 'editor':
      return `#/p/${encodeURIComponent(route.projectId)}`;
    case 'gallery':
      return '#/gallery';
    case 'learn':
      return '#/learn';
    case 'library':
      return route.query ? `#/library?q=${encodeURIComponent(route.query)}` : '#/library';
    case 'doc':
      return `#/library/${encodeURIComponent(route.id)}`;
    case 'lab':
      return '#/lab';
    case 'workspace':
      return '#/';
  }
}

/** Hash routes: `#/`, `#/p/<projectId>`, `#/gallery`, `#/learn`, `#/library[/<id>]`, `#/lab`. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash,
  );
  return parseHash(hash);
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

/** Applies the theme preference to <html data-theme>. */
export function useTheme(): void {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Editor keyboard shortcuts (Implementation.md §13.5). */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        useUi.getState().set({ commandOpen: true });
        return;
      }
      if (mod && key === 'e') {
        e.preventDefault();
        useUi.getState().set({ dialog: 'export' });
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((mod && key === 'z' && e.shiftKey) || (mod && key === 'y')) {
        e.preventDefault();
        redo();
      } else if (mod && key === 'c') copy();
      else if (mod && key === 'v') paste();
      else if (mod && key === 'd') {
        e.preventDefault();
        duplicate();
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (key === '/') {
        e.preventDefault();
        useUi.getState().set({ commandOpen: true });
      } else if (key === 'enter' || key === 'f2') {
        const selected = useProject.getState().selection.elements;
        if (selected.length === 1) {
          e.preventDefault();
          useUi.getState().set({ editingId: selected[0]! });
        }
      } else if (key === 'c' && !mod && !e.altKey) {
        // Connect mode: click the source, then the target (Implementation.md §13.10).
        const selected = useProject.getState().selection.elements;
        if (useUi.getState().connectMode) cancelConnectMode();
        else startConnectMode(selected.length === 1 ? selected[0] : undefined);
      } else if (key === 'f' && !mod && !e.altKey) {
        // Focus mode: dim what is not connected to the selection; Shift+F changes the depth.
        const ui = useUi.getState();
        if (e.shiftKey && ui.focusDepth)
          ui.set({ focusDepth: ((ui.focusDepth % 3) + 1) as 1 | 2 | 3 });
        else if (ui.focusDepth) ui.set({ focusDepth: null });
        else if (useProject.getState().selection.elements.length) ui.set({ focusDepth: 1 });
        else ui.toast({ tone: 'info', message: 'Select a shape, then press F to focus on it.' });
      } else if (key === 'escape') {
        if (useUi.getState().connectMode) cancelConnectMode();
        useUi.getState().set({ picker: null, editingId: null, contextMenu: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export type SaveStatus = 'saved' | 'saving' | 'error' | 'connecting' | 'offline' | 'conflict';

export type Screen = 'phone' | 'tablet' | 'desktop';

const PHONE = '(max-width: 639px)';
const TABLET = '(min-width: 640px) and (max-width: 1023px)';

function currentScreen(): Screen {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(PHONE).matches) return 'phone';
  if (window.matchMedia(TABLET).matches) return 'tablet';
  return 'desktop';
}

/** For event handlers that need the layout class without re-rendering on resize. */
export const isPhone = (): boolean => currentScreen() === 'phone';

/** Layout class by width (Implementation.md §13.10): phone < 640 ≤ tablet < 1024 ≤ desktop. */
export function useScreen(): Screen {
  return useSyncExternalStore(
    (listener) => {
      const queries = [PHONE, TABLET].map((q) => window.matchMedia(q));
      for (const q of queries) q.addEventListener('change', listener);
      return () => {
        for (const q of queries) q.removeEventListener('change', listener);
      };
    },
    currentScreen,
    () => 'desktop',
  );
}

/** Re-renders when a folder is opened or closed, or its files change. */
export function useFolder(): { open: boolean; name: string; revision: number } {
  const revision = useSyncExternalStore(
    (listener) => folder.subscribe(listener),
    () => folder.revision,
  );
  return { open: folder.isOpen, name: folder.name, revision };
}

/**
 * Saves the open project to IndexedDB 500 ms after the last change, at the latest 5 s
 * after the first unsaved change, and when the editor closes (§14.3).
 */
export function useAutosave(): SaveStatus {
  // Served projects are saved by the server (§14.3).
  const version = useProject((s) => (isServed(s.project?.id) ? 0 : s.version));
  const [status, setStatus] = useState<SaveStatus>('saved');
  const pending = useRef(false);

  const flush = useCallback(async () => {
    if (!pending.current) return;
    pending.current = false;
    const project = useProject.getState().baseline;
    if (!project) return;
    try {
      const saved = await saveProject(project);
      // Folder mode: the file in the folder is the real copy (§14.3).
      if (folder.isLinked(saved.id)) await folder.writeProject(saved);
      useProject.getState().markSaved(saved.revision, saved.updatedAt);
      if (!pending.current) setStatus('saved');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (version === 0) return;
    pending.current = true;
    setStatus('saving');
    const debounce = setTimeout(flush, 500);
    return () => clearTimeout(debounce);
  }, [version, flush]);

  useEffect(() => {
    if (status !== 'saving') return;
    const maxWait = setTimeout(flush, 5000);
    return () => clearTimeout(maxWait);
  }, [status, flush]);

  useEffect(() => {
    const onUnload = () => void flush();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      void flush();
    };
  }, [flush]);

  return status;
}

let activeSync: ServeSync | null = null;
const IDLE: SyncState = { status: 'connecting', pending: 0, conflict: null, lastRemote: null };

/** The open project's serve-mode sync, for the conflict banner and the status. */
export const currentSync = (): ServeSync | null => activeSync;

/**
 * Serve mode: connects the open project to `archguide serve`, sends this tab's changes and
 * applies everyone else's live (§14.5). Returns the sync state; outside serve mode, null.
 */
export function useServeSync(projectId: string): SyncState | null {
  const [sync, setSync] = useState<ServeSync | null>(null);
  useEffect(() => {
    if (!isServed(projectId)) return;
    const store = useProject.getState;
    const next = new ServeSync(projectId, {
      current: () => store().baseline,
      applyRemote: (ops, revision) => store().applyRemote(ops, revision),
      replaceRemote: (project) => store().replaceRemote(project),
      setRevision: (revision) => {
        const p = store().baseline;
        if (p && p.revision < revision) store().markSaved(revision, p.updatedAt);
      },
      rejected: (errors) =>
        useUi.getState().toast({
          tone: 'error',
          message: `The server did not save a change: ${errors[0]?.message ?? 'unknown error'}. The project was reloaded.`,
        }),
    });
    activeSync = next;
    onLocalChanges((ops) => next.send(ops));
    setSync(next);
    return () => {
      onLocalChanges(null);
      if (activeSync === next) activeSync = null;
      next.close();
    };
  }, [projectId]);
  return (
    useSyncExternalStore(
      (listener) => sync?.subscribe(listener) ?? (() => {}),
      () => (sync ? sync.state : null),
    ) ?? (isServed(projectId) ? IDLE : null)
  );
}
