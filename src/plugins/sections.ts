import type { Plugin } from '../types';
import { ATTRIBUTE } from '../core/dom';

export interface SectionsOptions {
  /** Share of the element that must be on screen, 0–1. Default 0.5. */
  ratio?: number;
  /** How long it must stay that visible, without a break, before it counts. Default 1000. */
  visibleMs?: number;
}

const VIEW = `${ATTRIBUTE}-view`;
const SELECTOR = `[${VIEW}]`;

/**
 * Sends `section_view` the first time in a page view that an element marked data-analy-view="name"
 * stays at least `ratio` visible for `visibleMs`, with the ms since the page view started. Elements
 * added later count too, and an SPA navigation lets every section count again.
 */
export function sections({ ratio = 0.5, visibleMs = 1000 }: SectionsOptions = {}): Plugin {
  return {
    name: 'sections',
    setup(analy) {
      if (typeof IntersectionObserver === 'undefined') return;
      // performance.now() when the current page view started: the first one starts at navigation.
      let viewStart = 0;
      const seen = new Set<string>();
      const timers = new Map<Element, ReturnType<typeof setTimeout>>();

      const stop = (el: Element) => {
        clearTimeout(timers.get(el));
        timers.delete(el);
      };
      const stopAll = () => {
        timers.forEach((timer) => clearTimeout(timer));
        timers.clear();
      };
      const count = (el: Element) => {
        timers.delete(el);
        const section = el.getAttribute(VIEW);
        if (!section || seen.has(section)) return;
        seen.add(section);
        analy.track('section_view', { section, timeToViewMs: Math.round(performance.now() - viewStart) });
      };
      const onChange = (entries: IntersectionObserverEntry[]) => {
        for (const { target, isIntersecting, intersectionRatio } of entries) {
          // A background tab still intersects; it only starts counting once the visitor can see it.
          const visible = isIntersecting && intersectionRatio >= ratio && document.visibilityState === 'visible';
          if (!visible) stop(target);
          else if (!timers.has(target)) timers.set(target, setTimeout(() => count(target), visibleMs));
        }
      };

      const observer = new IntersectionObserver(onChange, { threshold: ratio });
      // observe() ignores an element it already watches, so re-running the query picks up only new ones.
      const observeNew = () => document.querySelectorAll(SELECTOR).forEach((el) => observer.observe(el));
      // observe() reports where each element is right now, so observing afresh re-checks what is
      // already on screen: nothing else fires for a section that never moved.
      const observeAll = () => {
        observer.disconnect();
        observeNew();
      };
      const additions = new MutationObserver(observeNew);
      const onVisible = () => {
        if (document.visibilityState === 'visible') observeAll();
      };

      const offHide = analy.on('hide', stopAll);
      const offLeave = analy.on('leave', () => {
        stopAll();
        seen.clear();
        viewStart = performance.now();
        observeAll();
      });
      document.addEventListener('visibilitychange', onVisible);
      additions.observe(document.documentElement, { childList: true, subtree: true });
      observeNew();

      return () => {
        observer.disconnect();
        additions.disconnect();
        stopAll();
        document.removeEventListener('visibilitychange', onVisible);
        offHide();
        offLeave();
      };
    },
  };
}
