import type { Plugin } from '../types';

export interface PageviewsOptions {
  /** Count #hash changes as page views (hash-routed SPAs). Default false. */
  hash?: boolean;
}

/** Initial page view plus SPA navigations (pushState, replaceState, back/forward). */
export function pageviews({ hash = false }: PageviewsOptions = {}): Plugin {
  return {
    name: 'pageviews',
    setup(analy) {
      const key = () => location.pathname + location.search + (hash ? location.hash : '');
      let last = key();
      let active = true;
      const check = () => {
        const next = key();
        if (!active || next === last) return;
        last = next;
        analy.page();
      };
      // Deferred so frameworks that set document.title right after pushState report the new title.
      const checkSoon = () => void setTimeout(check, 0);

      for (const method of ['pushState', 'replaceState'] as const) {
        const original = history[method];
        history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
          const result = original.apply(this, args);
          checkSoon();
          return result;
        };
      }
      // Back/forward cache restores the old page without reloading the script: that is a new view.
      const onPageShow = (event: PageTransitionEvent) => {
        if (active && event.persisted) analy.page();
      };
      // Routers on the Navigation API (navigation.navigate() + intercept()) change the url without
      // pushState or popstate. Where it exists, a finished navigation runs the same deduped check.
      const navigation = (window as { navigation?: EventTarget }).navigation;
      addEventListener('popstate', checkSoon);
      addEventListener('pageshow', onPageShow);
      if (hash) addEventListener('hashchange', checkSoon);
      navigation?.addEventListener('navigatesuccess', checkSoon);
      analy.page();

      return () => {
        // History stays wrapped: unwrapping would break any library that wrapped it after us.
        active = false;
        removeEventListener('popstate', checkSoon);
        removeEventListener('pageshow', onPageShow);
        removeEventListener('hashchange', checkSoon);
        navigation?.removeEventListener('navigatesuccess', checkSoon);
      };
    },
  };
}
