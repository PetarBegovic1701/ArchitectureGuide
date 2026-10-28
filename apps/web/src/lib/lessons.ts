import { applyOps, startLesson } from '@archguide/core';
import { layoutProject } from '../actions';
import { placeOps } from './place';
import type { Lesson } from '@archguide/core';
import { catalog } from './catalog';
import { loadProject, saveProject } from '../persistence/db';
import { navigate } from '../hooks';
import { useProgress } from '../store/progress';

/** The browser project a lesson runs in: one per lesson, so it can be continued. */
export const lessonProjectId = (lesson: Lesson) => `lesson-${lesson.id.slice('lesson.'.length)}`;

/**
 * Opens a lesson on the real canvas (Implementation.md §17.5): continues its project, or
 * starts it from the lesson's start model. `restart` throws the old work away.
 */
export async function openLesson(lesson: Lesson, options: { restart?: boolean } = {}) {
  const id = lessonProjectId(lesson);
  const existing = options.restart ? undefined : await loadProject(id);
  const now = new Date().toISOString();
  if (!existing) {
    let project = { ...startLesson(lesson, catalog, now), id, name: `Lesson: ${lesson.title}` };
    // The start model has no positions: place it, then lay it out.
    const placed = applyOps(project, placeOps(project, project.views[0]!), catalog);
    if (placed.ok) project = await layoutProject(placed.project);
    await saveProject(project);
  }
  const progress = useProgress.getState();
  progress.update((p) => {
    const current = p.lessons[lesson.id];
    if (current && !options.restart && existing) return p;
    return {
      ...p,
      lessons: {
        ...p.lessons,
        [lesson.id]: {
          projectId: id,
          step: 0,
          completed: [],
          startedAt: now,
          // A finished lesson stays finished when the learner reviews it again.
          ...(current?.finishedAt ? { finishedAt: current.finishedAt } : {}),
        },
      },
    };
  });
  navigate({ page: 'editor', projectId: id });
}

/** The lesson that runs in a project, if any. */
export function lessonForProject(projectId: string, all: Iterable<Lesson>): Lesson | undefined {
  const progress = useProgress.getState().progress;
  for (const lesson of all) if (progress.lessons[lesson.id]?.projectId === projectId) return lesson;
  return undefined;
}
