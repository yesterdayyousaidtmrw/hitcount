import type { Hooks } from '../types';

type Listener<K extends keyof Hooks> = (arg: Hooks[K]) => void;

export function createHooks(onError: (error: unknown, source: string) => void) {
  const listeners = new Map<keyof Hooks, Set<(arg: never) => void>>();

  return {
    on<K extends keyof Hooks>(hook: K, fn: Listener<K>): () => void {
      let set = listeners.get(hook);
      if (!set) listeners.set(hook, (set = new Set()));
      set.add(fn);
      return () => void set.delete(fn);
    },
    emit<K extends keyof Hooks>(hook: K, arg: Hooks[K]): void {
      listeners.get(hook)?.forEach((fn) => {
        try {
          (fn as Listener<K>)(arg);
        } catch (error) {
          onError(error, `hook:${hook}`);
        }
      });
    },
    clear(): void {
      listeners.clear();
    },
  };
}
