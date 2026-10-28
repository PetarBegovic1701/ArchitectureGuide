import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Circle,
  CircleDot,
  Download,
  FlaskConical,
  GraduationCap,
  Search,
  Upload,
} from 'lucide-react';
import {
  TRACKS,
  contentCoverage,
  docsInTrack,
  isExercise,
  lessonStatus,
  mergeProgress,
  parseProgress,
  searchDocs,
  serializeProgress,
  trackSummaries,
} from '@archguide/core';
import type { Lesson, LessonStatus, Level } from '@archguide/core';
import { catalog, docs, lessons } from '../lib/catalog';
import { LEVELS } from '../lib/learn';
import { openLesson } from '../lib/lessons';
import { download } from '../actions';
import { hrefFor } from '../hooks';
import { useProgress } from '../store/progress';
import { useUi } from '../store/ui';
import { ConceptGuide } from '../panels/ConceptGuide';
import { DocBody } from '../panels/LearnPanel';
import { Markdown } from '../panels/Markdown';

const ALL_DOCS = [...docs.values()];
const ALL_LESSONS = [...lessons.values()];
const trackName = (id: string) => TRACKS.find((t) => t.id === id)?.name ?? id;

/** Header and frame of the learning pages (Implementation.md §17.7). */
function LearnShell({
  current,
  children,
}: {
  current: 'learn' | 'library' | 'lab';
  children: ReactNode;
}) {
  const level = useUi((s) => s.level);
  useEffect(() => void useProgress.getState().load(), []);
  const link = (page: 'learn' | 'library' | 'lab', label: string, icon: ReactNode) => (
    <a
      href={hrefFor({ page })}
      aria-current={current === page ? 'page' : undefined}
      className={`ag-touch flex items-center gap-1 rounded px-2 py-1 text-sm ${current === page ? 'bg-[var(--ag-panel-2)] font-semibold' : 'hover:bg-[var(--ag-panel-2)]'}`}
    >
      {icon}
      {label}
    </a>
  );
  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-[var(--ag-border)] bg-[var(--ag-panel)] px-2 py-1">
        <a
          href="#/"
          className="ag-touch flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-[var(--ag-panel-2)]"
        >
          <ArrowLeft size={16} aria-hidden /> Projects
        </a>
        <nav className="flex flex-wrap gap-1" aria-label="Learning">
          {link('learn', 'Lessons', <GraduationCap size={16} aria-hidden />)}
          {link('library', 'Library', <BookOpen size={16} aria-hidden />)}
          {link('lab', 'Concurrency lab', <FlaskConical size={16} aria-hidden />)}
        </nav>
        <div
          className="ml-auto flex rounded border border-[var(--ag-border)] text-xs"
          role="group"
          aria-label="Experience level"
        >
          {LEVELS.map((l: Level) => (
            <button
              key={l}
              type="button"
              aria-pressed={level === l}
              onClick={() => useUi.getState().setLevel(l)}
              className={`ag-touch px-2 py-1 capitalize ${level === l ? 'bg-[var(--ag-accent)] text-[var(--ag-accent-text)]' : ''}`}
            >
              {l}
            </button>
          ))}
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 p-4">{children}</main>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-[var(--ag-panel-2)] px-1.5 py-0.5 text-xs text-[var(--ag-muted)]">
      {children}
    </span>
  );
}

const STATUS: Record<LessonStatus, { label: string; icon: ReactNode; action: string }> = {
  new: { label: 'Not started', icon: <Circle size={14} aria-hidden />, action: 'Start' },
  started: { label: 'In progress', icon: <CircleDot size={14} aria-hidden />, action: 'Continue' },
  finished: {
    label: 'Finished',
    icon: <CheckCircle2 size={14} aria-hidden className="text-[var(--ag-valid)]" />,
    action: 'Review',
  },
};

function LessonCard({ lesson }: { lesson: Lesson }) {
  const status = useProgress((s) => lessonStatus(s.progress, lesson.id));
  const steps = useProgress((s) => s.progress.lessons[lesson.id]?.completed.length ?? 0);
  const s = STATUS[status];
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-[var(--ag-border)] bg-[var(--ag-panel)] p-3"
      data-testid={`lesson-${lesson.id}`}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Chip>{lesson.level}</Chip>
        <Chip>{lesson.minutes} min</Chip>
        {isExercise(lesson) && <Chip>Exercise</Chip>}
      </div>
      <h3 className="font-semibold">{lesson.title}</h3>
      <p className="flex-1 text-sm text-[var(--ag-muted)]">{lesson.summary}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="flex items-center gap-1" data-testid="lesson-status">
          {s.icon}
          {s.label}
          {status === 'started' && ` (${steps} of ${lesson.steps.length} steps)`}
        </span>
        <span className="ml-auto flex gap-1">
          {status !== 'new' && (
            <button
              type="button"
              className="ag-touch rounded border border-[var(--ag-border)] px-2 py-1"
              onClick={() => {
                if (window.confirm(`Start “${lesson.title}” again? Your canvas for it is reset.`))
                  void openLesson(lesson, { restart: true });
              }}
            >
              Start over
            </button>
          )}
          <button
            type="button"
            className="ag-touch rounded bg-[var(--ag-accent)] px-3 py-1 text-[var(--ag-accent-text)]"
            onClick={() => void openLesson(lesson)}
            aria-label={`${s.action}: ${lesson.title}`}
          >
            {s.action}
          </button>
        </span>
      </div>
    </li>
  );
}

/** Lessons per track, with level, time and progress; progress export and import. */
export function LearnPage() {
  const progress = useProgress((s) => s.progress);
  const toast = useUi((s) => s.toast);
  const file = useRef<HTMLInputElement>(null);
  const tracks = trackSummaries(
    ALL_LESSONS,
    progress,
    TRACKS.map((t) => t.id),
  );
  const finished = tracks.reduce((n, t) => n + t.finished, 0);
  const readCount = ALL_DOCS.filter((d) => progress.read[d.id]).length;

  const importFile = async (f: File) => {
    try {
      const theirs = parseProgress(await f.text());
      useProgress.getState().update((p) => mergeProgress(p, theirs));
      toast({ tone: 'success', message: 'Progress imported and merged with this browser’s.' });
    } catch (error) {
      toast({ tone: 'error', message: (error as Error).message });
    }
  };

  return (
    <LearnShell current="learn">
      <section className="space-y-2">
        <h1 className="text-2xl font-bold">Learn by building</h1>
        <p className="text-[var(--ag-muted)]">
          Each lesson runs on the real canvas. Every step is checked while you build, with hints and
          a “Show me” button when you are stuck. Exercises start from a design with problems: you
          fix them until the rules are happy.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span data-testid="progress-summary">
            {finished} of {ALL_LESSONS.length} lessons finished · {readCount} of {ALL_DOCS.length}{' '}
            texts read
          </span>
          <span className="ml-auto flex gap-1">
            <button
              type="button"
              className="ag-touch flex items-center gap-1 rounded border border-[var(--ag-border)] px-2 py-1"
              onClick={() =>
                download('archguide-progress.json', serializeProgress(progress), 'application/json')
              }
            >
              <Download size={14} aria-hidden /> Export progress
            </button>
            <button
              type="button"
              className="ag-touch flex items-center gap-1 rounded border border-[var(--ag-border)] px-2 py-1"
              onClick={() => file.current?.click()}
            >
              <Upload size={14} aria-hidden /> Import progress
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Import progress file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
          </span>
        </div>
      </section>
      {tracks.map((t) => (
        <section key={t.track} className="space-y-2" aria-labelledby={`track-${t.track}`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id={`track-${t.track}`} className="text-lg font-semibold">
              {trackName(t.track)}
            </h2>
            <span className="text-xs text-[var(--ag-muted)]">
              {t.finished} of {t.lessons.length} finished · {t.minutes} min
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded bg-[var(--ag-panel-2)]"
            role="progressbar"
            aria-label={`${trackName(t.track)} progress`}
            aria-valuemin={0}
            aria-valuemax={t.lessons.length}
            aria-valuenow={t.finished}
          >
            <div
              className="h-full bg-[var(--ag-valid)]"
              style={{ width: `${(100 * t.finished) / t.lessons.length}%` }}
            />
          </div>
          <p className="text-sm text-[var(--ag-muted)]">
            {TRACKS.find((x) => x.id === t.track)?.description}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {t.lessons.map((l) => (
              <LessonCard key={l.id} lesson={l} />
            ))}
          </ul>
        </section>
      ))}
    </LearnShell>
  );
}

function DocLink({ id }: { id: string }) {
  const doc = docs.get(id);
  const read = useProgress((s) => !!s.progress.read[id]);
  const title =
    doc?.title ?? catalog.concepts.get(id)?.name ?? catalog.relationTypes.get(id)?.name ?? id;
  return (
    <li className="py-1.5">
      <a
        href={hrefFor({ page: 'doc', id })}
        className="font-medium text-[var(--ag-accent)] hover:underline"
      >
        {title}
      </a>{' '}
      {doc && <Chip>{doc.kind}</Chip>} {doc && <Chip>{doc.level}</Chip>}{' '}
      {read && (
        <CheckCircle2 size={14} className="inline text-[var(--ag-valid)]" aria-label="read" />
      )}
      {doc && <p className="text-sm text-[var(--ag-muted)]">{doc.summary}</p>}
    </li>
  );
}

/** All texts by track, searchable (§17.7). */
export function LibraryPage({ query: initial = '' }: { query?: string }) {
  const [query, setQuery] = useState(initial);
  const results = useMemo(() => (query.trim() ? searchDocs(ALL_DOCS, query) : []), [query]);
  const coverage = useMemo(() => contentCoverage(catalog, ALL_DOCS), []);
  return (
    <LearnShell current="library">
      <section className="space-y-2">
        <h1 className="text-2xl font-bold">Library</h1>
        <p className="text-[var(--ag-muted)]">
          {ALL_DOCS.length} texts. Each one has a beginner and a senior version; pick your level at
          the top. Texts cover {coverage.concepts.covered} of {coverage.concepts.total} shapes and{' '}
          {coverage.relationTypes.covered} of {coverage.relationTypes.total} arrow types.
        </p>
        <label className="flex items-center gap-2 rounded border border-[var(--ag-border)] bg-[var(--ag-bg)] px-2 focus-within:border-[var(--ag-accent)]">
          <Search size={16} aria-hidden className="text-[var(--ag-muted)]" />
          <input
            type="search"
            aria-label="Search the library"
            placeholder="Search, e.g. idempotency, lost update, redux"
            className="w-full bg-transparent py-2 outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </section>
      {query.trim() ? (
        <section aria-label="Search results">
          <h2 className="text-sm text-[var(--ag-muted)]" role="status">
            {results.length} {results.length === 1 ? 'text' : 'texts'} for “{query.trim()}”
          </h2>
          <ul className="divide-y divide-[var(--ag-border)]">
            {results.map((d) => (
              <DocLink key={d.id} id={d.id} />
            ))}
          </ul>
        </section>
      ) : (
        TRACKS.map((t) => {
          const list = docsInTrack(ALL_DOCS, t.id);
          if (list.length === 0) return null;
          return (
            <section key={t.id} id={`lib-${t.id}`} aria-labelledby={`lib-h-${t.id}`}>
              <h2 id={`lib-h-${t.id}`} className="text-lg font-semibold">
                {t.name}
              </h2>
              <p className="text-sm text-[var(--ag-muted)]">{t.description}</p>
              <ul className="divide-y divide-[var(--ag-border)]">
                {list.map((d) => (
                  <DocLink key={d.id} id={d.id} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </LearnShell>
  );
}

/** One text at the reader's level, with its quiz, the concept guide and the lessons that use it. */
export function DocPage({ id }: { id: string }) {
  const level = useUi((s) => s.level);
  const doc = docs.get(id);
  const concept = catalog.concepts.get(id);
  const relationType = catalog.relationTypes.get(id);
  const title = doc?.title ?? concept?.name ?? relationType?.name;
  const teaching = ALL_LESSONS.filter((l) => l.conceptIds.includes(id));
  const related = doc?.related ?? [];
  if (!title)
    return (
      <LearnShell current="library">
        <p>
          There is no text “{id}”.{' '}
          <a className="text-[var(--ag-accent)] underline" href={hrefFor({ page: 'library' })}>
            Back to the library
          </a>
        </p>
      </LearnShell>
    );
  return (
    <LearnShell current="library">
      <article className="space-y-4" data-testid={`doc-${id}`}>
        <header className="space-y-1">
          <a
            href={hrefFor({ page: 'library' })}
            className="text-sm text-[var(--ag-accent)] hover:underline"
          >
            ← Library
          </a>
          <h1 className="text-2xl font-bold">{title}</h1>
          {doc && (
            <div className="flex flex-wrap gap-1">
              <Chip>{doc.kind}</Chip>
              <Chip>from {doc.level}</Chip>
              {doc.tracks.map((t) => (
                <Chip key={t}>{trackName(t)}</Chip>
              ))}
            </div>
          )}
        </header>
        {doc ? (
          <DocBody doc={doc} level={level} compact={false} />
        ) : (
          <>
            <Markdown>{concept?.docs ?? relationType?.docs ?? ''}</Markdown>
            <p className="text-sm text-[var(--ag-muted)]">There is no full text for this yet.</p>
          </>
        )}
        {concept && (
          <section className="space-y-2 border-t border-[var(--ag-border)] pt-3">
            <h2 className="font-semibold">On the canvas</h2>
            <ConceptGuide kind={concept.id} showAll />
          </section>
        )}
        {teaching.length > 0 && (
          <section className="space-y-2 border-t border-[var(--ag-border)] pt-3">
            <h2 className="font-semibold">Lessons that use this</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {teaching.map((l) => (
                <LessonCard key={l.id} lesson={l} />
              ))}
            </ul>
          </section>
        )}
        {related.length > 0 && (
          <section className="border-t border-[var(--ag-border)] pt-3">
            <h2 className="font-semibold">Related</h2>
            <ul className="divide-y divide-[var(--ag-border)]">
              {related.map((r) => (
                <DocLink key={r} id={r} />
              ))}
            </ul>
          </section>
        )}
      </article>
    </LearnShell>
  );
}

export { LearnShell };
