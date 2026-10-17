import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vitals } from '../src/plugins/vitals';
import { FakeObserver, setVisibility, track } from './helpers';

const observer = (type: string) => FakeObserver.of(type);

beforeEach(() => {
  FakeObserver.instances = [];
});

describe('vitals', () => {
  it('sends lcp, fcp, worst-burst cls and inp once, when the page is first hidden', () => {
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    const { sent } = track({ plugins: [vitals()] });
    observer('largest-contentful-paint').emit([{ startTime: 1200.4 }, { startTime: 2100.6 }]);
    observer('paint').emit([
      { name: 'first-paint', startTime: 300 },
      { name: 'first-contentful-paint', startTime: 450 },
    ]);
    observer('layout-shift').emit([
      { startTime: 1000, value: 0.1 },
      { startTime: 1500, value: 0.1 },
      { startTime: 1800, value: 0.5, hadRecentInput: true },
      { startTime: 4000, value: 0.15 },
    ]);
    observer('event').emit([
      { interactionId: 1, duration: 120 },
      { interactionId: 0, duration: 999 },
      { interactionId: 2, duration: 80 },
    ]);

    setVisibility('hidden');
    dispatchEvent(new Event('pagehide'));

    const sentVitals = sent.filter((e) => e.name === 'vitals');
    expect(sentVitals).toHaveLength(1);
    expect(sentVitals[0].props).toMatchObject({ lcp: 2101, fcp: 450, cls: 0.2, inp: 120 });
  });

  it('reports again on a later hide only when a metric changed, and stops after an SPA leave', () => {
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    const { hitcount, sent } = track({ plugins: [vitals()] });
    const vitalsSent = () => sent.filter((e) => e.name === 'vitals').map((e) => e.props);
    observer('largest-contentful-paint').emit([{ startTime: 900 }]);
    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('hidden');
    expect(vitalsSent()).toEqual([{ lcp: 900 }]);

    setVisibility('visible');
    observer('event').emit([{ interactionId: 1, duration: 300 }]);
    setVisibility('hidden');
    expect(vitalsSent()).toEqual([{ lcp: 900 }, { lcp: 900, inp: 300 }]);

    hitcount.page();
    hitcount.page();
    observer('event').emit([{ interactionId: 2, duration: 900 }]);
    setVisibility('hidden');
    expect(vitalsSent()).toHaveLength(2);
  });

  it('stays quiet when the browser has no PerformanceObserver', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const { sent } = track({ plugins: [vitals()] });
    expect(() => setVisibility('hidden')).not.toThrow();
    expect(sent.find((e) => e.name === 'vitals')?.props.lcp).toBeUndefined();
  });
});
