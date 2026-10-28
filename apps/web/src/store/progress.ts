import { create } from 'zustand';
import { emptyProgress, parseProgress, serializeProgress } from '@archguide/core';
import type { Progress } from '@archguide/core';
import { db } from '../persistence/db';
import { useUi } from './ui';

/**
 * The learner's progress (Implementation.md §17.9), loaded from IndexedDB once and saved
 * after every change. Without IndexedDB (private mode) it still works for the session.
 */
interface ProgressState {
  progress: Progress;
  loaded: boolean;
  load(): Promise<void>;
  update(change: (p: Progress) => Progress): void;
}

let saving: Promise<unknown> = Promise.resolve();

export const useProgress = create<ProgressState>((set, get) => ({
  progress: emptyProgress(),
  loaded: false,
  async load() {
    if (get().loaded) return;
    try {
      const row = await db.progress.get('me');
      set({ progress: row ? parseProgress(row.json) : emptyProgress(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  update(change) {
    const next = change(get().progress);
    if (next === get().progress) return;
    set({ progress: next });
    saving = saving
      .then(() => db.progress.put({ id: 'me', json: serializeProgress(next) }))
      .catch(() =>
        useUi.getState().toast({
          tone: 'error',
          message: 'Your progress could not be saved in this browser. Export it to keep it.',
        }),
      );
  },
}));

/** Waits for pending saves (tests, export). */
export const progressSaved = () => saving;
