/**
 * Undo/redo over immutable snapshots. Entries can be large (one GridModel is
 * ~9 bytes per cell), so the depth is capped.
 */
export const HISTORY_CAP = 50;

export type History<T> = { readonly past: readonly T[]; readonly future: readonly T[] };

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

/** record `previous` as an undo step (clears the redo branch) */
export function pushHistory<T>(h: History<T>, previous: T, cap = HISTORY_CAP): History<T> {
  const past = [...h.past, previous];
  return { past: past.length > cap ? past.slice(past.length - cap) : past, future: [] };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/** returns the snapshot to restore and the new history, or null at the end */
export function undoHistory<T>(h: History<T>, present: T): { restored: T; history: History<T> } | null {
  const restored = h.past[h.past.length - 1];
  if (restored === undefined) return null;
  return { restored, history: { past: h.past.slice(0, -1), future: [...h.future, present] } };
}

export function redoHistory<T>(h: History<T>, present: T): { restored: T; history: History<T> } | null {
  const restored = h.future[h.future.length - 1];
  if (restored === undefined) return null;
  return { restored, history: { past: [...h.past, present], future: h.future.slice(0, -1) } };
}
