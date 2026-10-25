// Per-browser session persistence (IndexedDB).
//
// Nothing here talks to a server: each visitor's files live in their own browser profile,
// so sessions on a public deployment are private to that visitor by construction.

import { State, StatePersister } from './app-state.ts';
import { idbDelete, idbGet, idbSet } from './idb-store.ts';
import { stateFromSerialized } from './fragment-state.ts';

const KEY = 'session-v1';
const SAVE_DELAY_MS = 500;

// 'browser': session saved in this browser's IndexedDB (default for a plain URL)
// 'url':     state travels in the URL fragment (shared / "New project" links; upstream behaviour)
// 'pwa':     installed-app mode (upstream LocalStorage persistence)
export type PersistenceMode = 'browser' | 'url' | 'pwa';
export let persistenceMode: PersistenceMode = 'url';
export function setPersistenceMode(mode: PersistenceMode) { persistenceMode = mode; }

let disabled = false;

export async function loadSavedState(): Promise<State | null> {
  try {
    const json = await idbGet<string>(KEY);
    if (!json) return null;
    const state = stateFromSerialized(JSON.parse(json));
    return state.params.sources?.length ? state : null;
  } catch (e) {
    console.error('Failed to read the saved session:', e);
    return null;
  }
}

export function createLocalStatePersister(): StatePersister & {baseline(initial: State): void} {
  // Model.mutate() edits the state tree in place (only the top-level object gets a new identity),
  // so object identity can't tell us whether the visitor's data changed. Compare content instead:
  // cheap `set` calls just remember the latest state, and the debounced flush serialises it and
  // writes only when {params, view} really differ from what was last saved.
  let latest: State | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved: string | undefined;
  let askedForPersistence = false;

  const snapshot = (s: State) => JSON.stringify({params: s.params, view: s.view});

  const flush = async () => {
    timer = undefined;
    if (disabled || !latest) return;
    try {
      const snap = snapshot(latest);
      if (snap === lastSaved) return;
      if (!askedForPersistence) {
        askedForPersistence = true;
        navigator.storage?.persist?.().catch(() => {});
      }
      await idbSet(KEY, JSON.stringify({params: latest.params, view: latest.view, preview: latest.preview}));
      lastSaved = snap;
    } catch (e) {
      console.error('Failed to save the session in this browser:', e);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer !== undefined) {
      clearTimeout(timer);
      flush();
    }
  });

  return {
    // The state the app started with (restored or default). Nothing is written until the
    // visitor actually changes something, so a first visit doesn't pin today's default example.
    baseline: (initial: State) => {
      lastSaved = snapshot(initial);
    },
    set: async (state: State) => {
      latest = state;
      if (timer === undefined) timer = setTimeout(flush, SAVE_DELAY_MS);
    }
  };
}

export async function clearSavedState() {
  disabled = true;
  await idbDelete(KEY);
}
