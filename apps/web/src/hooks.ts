import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { copy, deleteSelection, duplicate, paste, redo, undo } from './actions';
import { saveProject } from './persistence/db';
import { folder } from './persistence/folder';
import { useProject } from './store/project';
import { useUi } from './store/ui';

export type Route =
  { page: 'workspace' } | { page: 'editor'; projectId: string } | { page: 'gallery' };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const editor = /^\/p\/([^/]+)/.exec(path);
  if (editor) return { page: 'editor', projectId: decodeURIComponent(editor[1]!) };
  if (path.startsWith('/gallery')) return { page: 'gallery' };
  return { page: 'workspace' };
}

/** Hash routes: `#/`, `#/p/<projectId>`, `#/gallery`. */
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
  window.location.hash =
    route.page === 'editor'
      ? `#/p/${encodeURIComponent(route.projectId)}`
      : route.page === 'gallery'
        ? '#/gallery'
        : '#/';
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
      } else if (key === 'escape') {
        useUi.getState().set({ picker: null, editingId: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export type SaveStatus = 'saved' | 'saving' | 'error';

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
  const version = useProject((s) => s.version);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const pending = useRef(false);

  const flush = useCallback(async () => {
    if (!pending.current) return;
    pending.current = false;
    const project = useProject.getState().project;
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
