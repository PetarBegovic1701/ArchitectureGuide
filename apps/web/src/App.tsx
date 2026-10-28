import { Suspense, lazy } from 'react';
import { Workspace } from './pages/Workspace';
import { Toasts } from './panels/Overlays';
import { useEffect } from 'react';
import { useRoute, useTheme } from './hooks';
import { useProgress } from './store/progress';

// The editor (React Flow, Markdown, property forms) loads only when a project opens.
const Editor = lazy(() => import('./pages/Editor').then((m) => ({ default: m.Editor })));
const Gallery = lazy(() => import('./pages/Gallery').then((m) => ({ default: m.Gallery })));
const LearnPage = lazy(() => import('./pages/Learn').then((m) => ({ default: m.LearnPage })));
const LibraryPage = lazy(() => import('./pages/Learn').then((m) => ({ default: m.LibraryPage })));
const DocPage = lazy(() => import('./pages/Learn').then((m) => ({ default: m.DocPage })));
const LabPage = lazy(() => import('./pages/Lab').then((m) => ({ default: m.LabPage })));

export function App() {
  useTheme();
  const route = useRoute();
  useEffect(() => void useProgress.getState().load(), []);
  return (
    <>
      <Suspense fallback={<p className="p-10 text-[var(--ag-muted)]">Loading…</p>}>
        {route.page === 'editor' ? (
          <Editor key={route.projectId} projectId={route.projectId} />
        ) : route.page === 'gallery' ? (
          <Gallery />
        ) : route.page === 'learn' ? (
          <LearnPage />
        ) : route.page === 'library' ? (
          <LibraryPage query={route.query} />
        ) : route.page === 'doc' ? (
          <DocPage key={route.id} id={route.id} />
        ) : route.page === 'lab' ? (
          <LabPage />
        ) : (
          <Workspace />
        )}
      </Suspense>
      <Toasts />
    </>
  );
}
