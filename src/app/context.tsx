import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Commands } from '../domain/commands';
import type { Tables } from '../domain/types';
import type { Store } from '../data/store';

interface AppCtx {
  store: Store;
  cmd: Commands;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ store, cmd, children }: AppCtx & { children: ReactNode }) {
  const value = useMemo(() => ({ store, cmd }), [store, cmd]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppProvider mangler');
  return c;
}

/** Re-renders when the tables change; `select` runs against the current tables. */
export function useView<T>(select: (t: Tables) => T, deps: unknown[] = []): T {
  const { store } = useApp();
  const tables = useSyncExternalStore(store.subscribe, store.getTables);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => select(tables), [tables, ...deps]);
}

/**
 * Wraps a command so the screen gets a busy flag and a readable error.
 * Errors are shown to the user, not swallowed.
 */
export function useCommand() {
  const { cmd } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: (c: Commands) => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn(cmd);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [cmd]);
  return { run, error, busy, clearError: () => setError(null), cmd };
}
