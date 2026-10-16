import type { VitalsProps } from '../events';
import type { Plugin } from '../types';

type Entry = PerformanceEntry & { value?: number; hadRecentInput?: boolean; interactionId?: number };

function observe(type: string, onEntries: (entries: Entry[]) => void, extra: object = {}) {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) {
    return undefined;
  }
  const observer = new PerformanceObserver((list) => onEntries(list.getEntries() as Entry[]));
  observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  return observer;
}

/**
 * Core Web Vitals from real visitors as `vitals`: lcp, cls, inp, fcp, ttfb (ms; cls unitless).
 * Sent when the page is hidden, again on later hides if a metric changed. Keep the last one per viewId.
 */
export function vitals(): Plugin {
  return {
    name: 'vitals',
    setup(analy) {
      const metrics: VitalsProps = {};
      let windowValue = 0;
      let windowStart = 0;
      let lastShift = 0;

      const observers = [
        observe('largest-contentful-paint', (entries) => {
          const last = entries[entries.length - 1];
          if (last) metrics.lcp = last.startTime;
        }),
        observe('paint', (entries) => {
          for (const e of entries) if (e.name === 'first-contentful-paint') metrics.fcp = e.startTime;
        }),
        observe('layout-shift', (entries) => {
          for (const e of entries) {
            if (e.hadRecentInput || e.value === undefined) continue;
            // CLS is the worst burst of shifts: a window closes after a 1s gap or 5s total.
            if (windowValue && e.startTime - lastShift < 1000 && e.startTime - windowStart < 5000) {
              windowValue += e.value;
            } else {
              windowValue = e.value;
              windowStart = e.startTime;
            }
            lastShift = e.startTime;
            metrics.cls = Math.max(metrics.cls ?? 0, windowValue);
          }
        }),
        // INP approximated as the slowest interaction, which is exact below 50 interactions.
        observe(
          'event',
          (entries) => {
            for (const e of entries) if (e.interactionId) metrics.inp = Math.max(metrics.inp ?? 0, e.duration);
          },
          { durationThreshold: 40 },
        ),
      ];
      const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (navigation && navigation.responseStart > 0) metrics.ttfb = navigation.responseStart;

      let lastReport = '{}';
      let done = false;
      // CLS and INP keep growing after the first hide, so every hide re-reports if anything changed.
      // An SPA leave is final: later shifts and interactions belong to the next soft navigation.
      const report = (final: boolean) => {
        if (done) return;
        if (final) {
          done = true;
          observers.forEach((o) => o?.disconnect());
        }
        const props: VitalsProps = {};
        for (const [name, value] of Object.entries(metrics) as Array<[keyof VitalsProps, number]>) {
          props[name] = name === 'cls' ? Math.round(value * 10_000) / 10_000 : Math.round(value);
        }
        const snapshot = JSON.stringify(props);
        if (snapshot === lastReport) return;
        lastReport = snapshot;
        analy.track('vitals', props);
      };
      const offHide = analy.on('hide', () => report(false));
      const offLeave = analy.on('leave', () => report(true));

      return () => {
        offHide();
        offLeave();
        observers.forEach((o) => o?.disconnect());
      };
    },
  };
}
