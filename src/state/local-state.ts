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
  let lastParams: State['params'] | undefined;
  let lastView: State['view'] | undefined;
  let latest: State | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let askedForPersistence = false;

  const flush = async () => {
    timer = undefined;
    if (disabled || !latest) return;
    try {
      await idbSet(KEY, JSON.stringify({params: latest.params, view: latest.view, preview: latest.preview}));
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
      lastParams = initial.params;
      lastView = initial.view;
    },
    set: async (state: State) => {
      // Most state updates are render logs / outputs / thumbnails. Only a change to the visitor's
      // params or view starts a save (the preview thumbnail is saved along with them).
      if (state.params === lastParams && state.view === lastView) return;
      lastParams = state.params;
      lastView = state.view;
      latest = state;
      if (!askedForPersistence) {
        askedForPersistence = true;
        navigator.storage?.persist?.().catch(() => {});
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    }
  };
}

export async function clearSavedState() {
  disabled = true;
  await idbDelete(KEY);
}
