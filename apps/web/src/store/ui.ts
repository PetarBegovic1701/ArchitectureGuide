import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Id, Level, RelationType } from '@archguide/core';
import type { ClipboardData } from '../lib/clipboard';

export type Theme = 'system' | 'light' | 'dark';

/** What the Learn tab shows. */
export type LearnTarget =
  | { kind: 'selection' }
  | { kind: 'doc'; id: string }
  | { kind: 'refusal'; sourceKind: string; targetKind: string; message: string };

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  tone: 'error' | 'info' | 'success';
  message: string;
  actions?: ToastAction[];
}

export interface RelationPickerState {
  sourceId: Id;
  targetId: Id;
  types: RelationType[];
  x: number;
  y: number;
}

interface UiState {
  // Persisted preferences (per browser).
  level: Level;
  paletteMode: 'basic' | 'full';
  theme: Theme;
  /** Last relation type picked per "sourceKind→targetKind", offered first next time. */
  preferredTypes: Record<string, string>;

  // Session state.
  inspectorTab: 'properties' | 'learn';
  learnTarget: LearnTarget;
  toasts: Toast[];
  editingId: Id | null;
  /** Elements created in this session whose ID still follows their first name. */
  freshIds: Id[];
  connecting: { sourceId: Id; validTargets: ReadonlySet<Id> } | null;
  picker: RelationPickerState | null;
  commandOpen: boolean;
  clipboard: ClipboardData | null;

  setLevel(level: Level): void;
  setPaletteMode(mode: 'basic' | 'full'): void;
  setTheme(theme: Theme): void;
  preferType(pairKey: string, type: string): void;
  openLearn(target: LearnTarget): void;
  setInspectorTab(tab: 'properties' | 'learn'): void;
  toast(toast: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
  set(partial: Partial<UiState>): void;
}

let nextToast = 1;

/** localStorage can be missing or throw (private mode); the app must work without it. */
const safeStorage = createJSONStorage(() => {
  try {
    const probe = '__archguide__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
  }
});

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      level: 'beginner',
      paletteMode: 'basic',
      theme: 'system',
      preferredTypes: {},
      inspectorTab: 'properties',
      learnTarget: { kind: 'selection' },
      toasts: [],
      editingId: null,
      freshIds: [],
      connecting: null,
      picker: null,
      commandOpen: false,
      clipboard: null,

      setLevel: (level) => set(level === 'beginner' ? { level, paletteMode: 'basic' } : { level }),
      setPaletteMode: (paletteMode) => set({ paletteMode }),
      setTheme: (theme) => set({ theme }),
      preferType: (pairKey, type) =>
        set((s) => ({ preferredTypes: { ...s.preferredTypes, [pairKey]: type } })),
      openLearn: (learnTarget) => set({ learnTarget, inspectorTab: 'learn' }),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      toast: (toast) =>
        set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id: nextToast++ }] })),
      dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      set: (partial) => set(partial),
    }),
    {
      name: 'archguide-ui',
      storage: safeStorage,
      partialize: (s) => ({
        level: s.level,
        paletteMode: s.paletteMode,
        theme: s.theme,
        preferredTypes: s.preferredTypes,
      }),
    },
  ),
);
