import type { Persist, Store } from '../types';

export function memoryStore(): Store {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key),
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}

// Web Storage throws in sandboxed iframes and some privacy modes; undefined tells the caller to use memory.
function webStore(area: 'localStorage' | 'sessionStorage'): Store | undefined {
  try {
    const storage = window[area];
    storage.setItem('_analy', '1');
    storage.removeItem('_analy');
    return {
      get: (key) => storage.getItem(key) ?? undefined,
      set: (key, value) => storage.setItem(key, value),
      remove: (key) => storage.removeItem(key),
    };
  } catch {
    return undefined;
  }
}

// Cookies can throw (blocked site data, sandboxed frames) or silently not stick (a cookieDomain the
// page is not on), so the store is probed first; undefined tells the caller to use memory.
// Keys and values are URI-encoded: analy.store takes any string, and a cookie cannot hold ; , = or spaces.
function cookieStore(domain?: string): Store | undefined {
  const scope = `;path=/${domain ? `;domain=${domain}` : ''}`;
  const secure = location.protocol === 'https:' ? ';secure' : '';
  const store: Store = {
    get: (key) => {
      const name = `${encodeURIComponent(key)}=`;
      const value = document.cookie.split('; ').find((cookie) => cookie.startsWith(name))?.slice(name.length);
      try {
        return value && decodeURIComponent(value);
      } catch {
        // Written raw before values were encoded: ids never hold a %, a user id rarely does.
        return value;
      }
    },
    set: (key, value) => {
      document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}${scope};max-age=31536000;samesite=lax${secure}`;
    },
    remove: (key) => {
      document.cookie = `${encodeURIComponent(key)}=${scope};expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    },
  };
  try {
    store.set('_analy', '1');
    const works = store.get('_analy') === '1';
    store.remove('_analy');
    return works ? store : undefined;
  } catch {
    return undefined;
  }
}

/** document.cookie, or '' where reading it throws (blocked site data, sandboxed frames). */
export function readCookies(): string {
  try {
    return document.cookie;
  } catch {
    return '';
  }
}

export function createStore(persist: Persist, cookieDomain?: string): Store {
  if (persist === 'cookie') return cookieStore(cookieDomain) ?? memoryStore();
  if (persist === 'local') return webStore('localStorage') ?? memoryStore();
  if (persist === 'session') return webStore('sessionStorage') ?? memoryStore();
  return memoryStore();
}
