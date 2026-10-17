import type { SearchProps } from '../events';
import type { Hitcount, Plugin } from '../types';

export interface SearchOptions {
  /** URL params that carry a site-search query, checked in this order. */
  params?: string[];
}

type Found = Pick<SearchProps, 'query' | 'param'>;

const RESULTS = 'data-hitcount-results';
// Long enough for a search API to answer and the page to render, short enough that a quick exit
// still finds the event pending (it is sent on leave and hide too).
const SETTLE_MS = 2000;

/** The whole number in the page's data-hitcount-results attribute, or undefined. */
function resultsOnPage(): number | undefined {
  const value = document.querySelector(`[${RESULTS}]`)?.getAttribute(RESULTS)?.trim();
  const count = Number(value);
  return value && Number.isInteger(count) && count >= 0 ? count : undefined;
}

function queryIn(url: string, params: string[]): Found | undefined {
  const values = new URL(url, location.href).searchParams;
  for (const param of params) {
    const query = values.get(param)?.trim();
    if (query) return { query, param };
  }
  return undefined;
}

/**
 * Sends `search` for each page view whose URL carries a site-search query (?q=, ?s=, …), with the
 * result count from the page's data-hitcount-results attribute when it has one.
 */
export function search({ params = ['q', 'query', 's', 'search', 'keyword', 'term'] }: SearchOptions = {}): Plugin {
  // The search page view still waiting for its results.
  let pending: { hitcount: Hitcount; found: Found; stop(): void } | undefined;

  const stop = () => {
    const current = pending;
    pending = undefined;
    current?.stop();
    return current;
  };
  const settle = () => {
    const current = stop();
    current?.hitcount.track('search', { ...current.found, results: resultsOnPage() });
  };

  // SPA results render after the URL changes, and the last search's count can still be on screen
  // then. So the count is read once the page settles: as soon as a count other than the one there
  // at the page view appears, or after SETTLE_MS (a server-rendered page, or the same count again),
  // or when the view ends or the page is hidden, whichever comes first.
  const watch = (hitcount: Hitcount, found: Found) => {
    const before = resultsOnPage();
    const observer = new MutationObserver(() => {
      const results = resultsOnPage();
      if (results !== undefined && results !== before) settle();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: [RESULTS] });
    const timer = setTimeout(settle, SETTLE_MS);
    pending = {
      hitcount,
      found,
      stop: () => {
        observer.disconnect();
        clearTimeout(timer);
      },
    };
  };

  return {
    name: 'search',
    setup(hitcount) {
      const offLeave = hitcount.on('leave', settle);
      const offHide = hitcount.on('hide', settle);
      return () => {
        stop();
        offLeave();
        offHide();
      };
    },
    // Page views are caught here rather than with a hook from setup: pageviews sends the first one
    // from its own setup, which can run before this one.
    enrich(event, hitcount) {
      if (event.name !== 'pageview') return event;
      settle();
      const found = queryIn(event.page.url, params);
      if (found) watch(hitcount, found);
      return event;
    },
  };
}
