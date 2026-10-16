import type { Persist } from '../types';
import { createStore, memoryStore, type Store } from './storage';
import { uid } from './uid';

const VISITOR = '_analy_v';
const SESSION = '_analy_s';
const USER = '_analy_u';
const KEYS = [VISITOR, SESSION, USER];

export interface Identity {
  /** Move from the in-memory store to the configured one. Called once consent is granted. */
  enable(): void;
  visitor(): string | undefined;
  /** Current session id; touching it extends the session. */
  session(): string;
  user(): string | undefined;
  setUser(id: string): void;
  /** New visitor and session, no user. */
  reset(): void;
  /** Delete stored ids and go back to memory (consent withdrawn). */
  wipe(): void;
}

export function createIdentity(persist: Persist, timeoutMs: number, cookieDomain?: string): Identity {
  const persistent = persist === 'local' || persist === 'cookie';
  let store: Store = memoryStore();
  let userId: string | undefined;

  const forget = () => {
    userId = undefined;
    KEYS.forEach((key) => store.remove(key));
  };

  return {
    enable() {
      store = createStore(persist, cookieDomain);
      userId ??= store.get(USER);
      if (userId) store.set(USER, userId);
    },
    visitor() {
      if (!persistent) return undefined;
      let id = store.get(VISITOR);
      if (!id) {
        id = uid();
        store.set(VISITOR, id);
      }
      return id;
    },
    session() {
      const now = Date.now();
      const [id, lastSeen] = (store.get(SESSION) ?? '').split('.');
      const current = id && now - Number(lastSeen) < timeoutMs ? id : uid();
      store.set(SESSION, `${current}.${now}`);
      return current;
    },
    user: () => userId,
    setUser(id) {
      userId = id;
      store.set(USER, id);
    },
    reset: forget,
    wipe() {
      forget();
      store = memoryStore();
    },
  };
}
