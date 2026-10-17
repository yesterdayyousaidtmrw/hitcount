import type { Persist, Store } from '../types';
import { createStore, memoryStore } from './storage';
import { uid } from './uid';

const VISITOR = '_hitcount_v';
const SESSION = '_hitcount_s';
const USER = '_hitcount_u';
const KEYS = [VISITOR, SESSION, USER];
// hitcount.store keys sit beside the ids so they follow the same consent and persist rules.
const EXTRA = '_hitcount_x_';

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
  /** hitcount.store: plugin keys, removed by reset() and wipe() with the ids. */
  store: Store;
}

/** givenVisitor: the site's own visitor id. It wins over persist and is never stored or forgotten here. */
export function createIdentity(persist: Persist, timeoutMs: number, cookieDomain?: string, givenVisitor?: string): Identity {
  const persistent = persist === 'local' || persist === 'cookie';
  let store: Store = memoryStore();
  let userId: string | undefined;
  // Every key used on this page, so forget() can remove them: a Store cannot list its keys.
  const keys = new Set(KEYS);
  const storeKey = (key: string) => {
    keys.add(EXTRA + key);
    return EXTRA + key;
  };

  const forget = () => {
    userId = undefined;
    keys.forEach((key) => store.remove(key));
  };

  return {
    enable() {
      store = createStore(persist, cookieDomain);
      userId ??= store.get(USER);
      if (userId) store.set(USER, userId);
    },
    visitor() {
      if (givenVisitor) return givenVisitor;
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
    store: {
      get: (key) => store.get(storeKey(key)),
      set: (key, value) => store.set(storeKey(key), value),
      remove: (key) => store.remove(storeKey(key)),
    },
  };
}
