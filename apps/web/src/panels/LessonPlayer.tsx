import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDashed,
  GraduationCap,
  Lightbulb,
  Wand2,
} from 'lucide-react';
import { adaptSolution, applyOps, checkStep, completeStep } from '@archguide/core';
import type { Lesson, LessonStep, Project } from '@archguide/core';
import { canvasApi, dispatch } from '../actions';
import { catalog, lessons } from '../lib/catalog';
import { findingsOf } from '../lib/findings';
import { activeView, elementById } from '../lib/model';
import { placeOps } from '../lib/place';
import { hrefFor, navigate } from '../hooks';
import { useProgress } from '../store/progress';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { Markdown } from './Markdown';

/** The lesson that runs in the open project, if any (its progress entry names the project). */
export function useActiveLesson(projectId: string): Lesson | undefined {
  const lessonId = useProgress((s) => {
    for (const [id, p] of Object.entries(s.progress.lessons))
      if (p.projectId === projectId) return id;
    return undefined;
  });
  return lessonId ? lessons.get(lessonId) : undefined;
}

/**
 * "Show me": applies the step's solution, adapted to the learner's own shapes, and places
 * the new shapes on the canvas, as one undo step.
 */
function showMe(project: Project, lesson: Lesson, step: LessonStep): boolean {
  const ops = adaptSolution(project, lesson, step);
  const trial = applyOps(project, ops, catalog);
  if (!trial.ok) return false;
  const view = activeView(trial.project, useProject.getState().viewId);
  if (!dispatch([...ops, ...placeOps(trial.project, view)], { label: 'Show me' })) return false;
  setTimeout(() => canvasApi.focus?.(trial.project.model.elements.map((e) => e.id)), 80);
  return true;
}

/**
 * The lesson player (Implementation.md §17.5): the current step over the canvas, checked
 * after every change, with hints, "Show me" and the success text. The canvas stays usable.
 */
export function LessonPlayer({
  lesson,
  variant,
}: {
  lesson: Lesson;
  /** dock: a column beside the canvas (desktop); float: over the canvas; sheet: phones. */
  variant: 'dock' | 'float' | 'sheet';
}) {
  const project = useProject((s) => s.project)!;
  const saved = useProgress((s) => s.progress.lessons[lesson.id]);
  const reached = Math.min(saved?.step ?? 0, lesson.steps.length - 1);
  const [index, setIndex] = useState(reached);
  const [hints, setHints] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const step = lesson.steps[index]!;
  const done = saved?.completed.includes(step.id) ?? false;
  const finished = !!saved?.finishedAt && saved.completed.length === lesson.steps.length;

  const result = useMemo(
    () => checkStep(project, step, { catalog, findings: findingsOf(project) }),
    [project, step],
  );

  // Starts at the saved step; after that only Next and Back move, so the success text of a
  // finished step stays in view until the learner moves on.
  useEffect(() => setHints(0), [index]);

  // A task step is finished the moment its check passes.
  useEffect(() => {
    if (step.check && result.passed && !done)
      useProgress
        .getState()
        .update((p) => completeStep(p, lesson, step.id, new Date().toISOString()));
  }, [step, result.passed, done, lesson]);

  // Point at the step's shapes.
  useEffect(() => {
    const focus = (step.focus ?? []).filter((id) => elementById(project, id));
    useUi.getState().set({ lessonFocus: focus });
    if (focus.length) setTimeout(() => canvasApi.focus?.(focus), 50);
    return () => useUi.getState().set({ lessonFocus: [] });
    // Only when the step changes, not on every edit.
  }, [step]);

  const next = () => {
    if (!step.check && !done)
      useProgress
        .getState()
        .update((p) => completeStep(p, lesson, step.id, new Date().toISOString()));
    setIndex((i) => Math.min(i + 1, lesson.steps.length - 1));
  };
  const last = index === lesson.steps.length - 1;
  const passed = step.check ? result.passed || done : true;
  const following = [...lessons.values()].find(
    (l) =>
      l.track === lesson.track &&
      l.id !== lesson.id &&
      !useProgress.getState().progress.lessons[l.id]?.finishedAt,
  );
  const button =
    'ag-touch flex items-center gap-1 rounded border border-[var(--ag-border)] px-2 py-1 text-xs hover:bg-[var(--ag-panel-2)] disabled:opacity-40';

  return (
    <section
      aria-label="Lesson"
      data-testid="lesson-player"
      className={`flex flex-col bg-[var(--ag-panel)] ${
        variant === 'dock'
          ? 'h-full w-80 shrink-0 border-r border-[var(--ag-border)]'
          : `absolute z-30 rounded-lg border border-[var(--ag-accent)] shadow-xl ${variant === 'sheet' ? 'inset-x-2 bottom-2 max-h-[55%]' : 'left-3 top-3 max-h-[calc(100%-24px)] w-[22rem] max-w-[calc(100%-24px)]'}`
      }`}
    >
      <header className="flex items-center gap-2 border-b border-[var(--ag-border)] px-3 py-2">
        <GraduationCap size={16} className="shrink-0 text-[var(--ag-accent)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-[var(--ag-muted)]">{lesson.title}</div>
          <div className="text-xs font-semibold" data-testid="lesson-step-count">
            Step {index + 1} of {lesson.steps.length}
          </div>
        </div>
        <button
          type="button"
          className="ag-touch rounded p-1 hover:bg-[var(--ag-panel-2)]"
          aria-label={collapsed ? 'Show the lesson' : 'Hide the lesson'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </header>
      <div className="flex h-1 bg-[var(--ag-panel-2)]" aria-hidden>
        {lesson.steps.map((s, i) => (
          <span
            key={s.id}
            className={`flex-1 ${saved?.completed.includes(s.id) ? 'bg-[var(--ag-valid)]' : i === index ? 'bg-[var(--ag-accent)]' : ''}`}
          />
        ))}
      </div>
      {!collapsed && (
        <>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm">
            <h3 className="font-semibold">{step.title}</h3>
            <Markdown>{step.body}</Markdown>
            {step.check && (
              <div
                role="status"
                data-testid="lesson-status"
                className={`flex items-start gap-1.5 rounded p-2 text-xs ${passed ? 'bg-[color-mix(in_srgb,var(--ag-valid)_12%,transparent)]' : 'bg-[var(--ag-panel-2)]'}`}
              >
                {passed ? (
                  <CheckCircle2
                    size={14}
                    className="mt-0.5 shrink-0 text-[var(--ag-valid)]"
                    aria-hidden
                  />
                ) : (
                  <CircleDashed
                    size={14}
                    className="mt-0.5 shrink-0 text-[var(--ag-muted)]"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  {passed ? (
                    <strong>Done!</strong>
                  ) : (
                    <details>
                      <summary className="cursor-pointer">Not done yet. What is missing?</summary>
                      <ul className="mt-1 list-disc pl-4">
                        {result.failures.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </div>
            )}
            {passed && step.success && (
              <div
                className="rounded border-l-4 border-[var(--ag-valid)] pl-2"
                data-testid="lesson-success"
              >
                <Markdown>{step.success}</Markdown>
              </div>
            )}
            {!passed &&
              step.hints?.slice(0, hints).map((h, i) => (
                <p key={i} className="flex gap-1.5 rounded bg-[var(--ag-panel-2)] p-2 text-xs">
                  <Lightbulb size={14} className="shrink-0 text-[var(--ag-warning)]" aria-hidden />
                  {h}
                </p>
              ))}
            {last && finished && (
              <div
                className="space-y-1 rounded border border-[var(--ag-valid)] p-2"
                data-testid="lesson-complete"
              >
                <p className="font-semibold">Lesson complete.</p>
                <p className="text-xs">
                  <a
                    className="text-[var(--ag-accent)] hover:underline"
                    href={hrefFor({ page: 'learn' })}
                  >
                    Back to the lessons
                  </a>
                  {following && (
                    <>
                      {' · Next in this track: '}
                      <a
                        className="text-[var(--ag-accent)] hover:underline"
                        href={hrefFor({ page: 'learn' })}
                      >
                        {following.title}
                      </a>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-1 border-t border-[var(--ag-border)] px-3 py-2">
            <button
              type="button"
              className={button}
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
              aria-label="Previous step"
            >
              <ChevronLeft size={14} aria-hidden />
            </button>
            {!passed && (step.hints?.length ?? 0) > 0 && (
              <button
                type="button"
                className={button}
                disabled={hints >= step.hints!.length}
                onClick={() => setHints(hints + 1)}
              >
                <Lightbulb size={14} aria-hidden />
                Hint {hints > 0 ? `(${hints}/${step.hints!.length})` : ''}
              </button>
            )}
            {!passed && step.solution && (
              <button
                type="button"
                className={button}
                onClick={() => {
                  if (!showMe(project, lesson, step))
                    useUi.getState().toast({
                      tone: 'error',
                      message:
                        '“Show me” could not change your canvas the way this step expects. Undo your last changes, or start the lesson over from the Lessons page.',
                    });
                }}
              >
                <Wand2 size={14} aria-hidden /> Show me
              </button>
            )}
            <span className="ml-auto flex gap-1">
              {last ? (
                <button
                  type="button"
                  className={button}
                  onClick={() => navigate({ page: 'learn' })}
                >
                  Leave
                </button>
              ) : (
                <button
                  type="button"
                  className="ag-touch flex items-center gap-1 rounded bg-[var(--ag-accent)] px-3 py-1 text-xs text-[var(--ag-accent-text)] disabled:opacity-40"
                  disabled={!passed}
                  onClick={next}
                >
                  Next <ChevronRight size={14} aria-hidden />
                </button>
              )}
              {last && !step.check && !done && (
                <button
                  type="button"
                  className="ag-touch rounded bg-[var(--ag-accent)] px-3 py-1 text-xs text-[var(--ag-accent-text)]"
                  onClick={next}
                >
                  Finish
                </button>
              )}
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
