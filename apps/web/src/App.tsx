import { Suspense, lazy } from 'react';
import { Workspace } from './pages/Workspace';
import { Toasts } from './panels/Overlays';
import { useRoute, useTheme } from './hooks';

// The editor (React Flow, Markdown, property forms) loads only when a project opens.
const Editor = lazy(() => import('./pages/Editor').then((m) => ({ default: m.Editor })));
const Gallery = lazy(() => import('./pages/Gallery').then((m) => ({ default: m.Gallery })));

export function App() {
  useTheme();
  const route = useRoute();
  return (
    <>
      <Suspense fallback={<p className="p-10 text-[var(--ag-muted)]">Loading…</p>}>
        {route.page === 'editor' ? (
          <Editor key={route.projectId} projectId={route.projectId} />
        ) : route.page === 'gallery' ? (
          <Gallery />
        ) : (
          <Workspace />
        )}
      </Suspense>
      <Toasts />
    </>
  );
}
