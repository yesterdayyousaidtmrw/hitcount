import { createAnaly } from '../src/core/tracker';
import type { Analy, AnalyEvent, AnalyOptions, SendMeta } from '../src/types';

const live: Analy[] = [];

/** A tracker that records what it sends. batchSize 1 so every event is sent immediately. */
export function track(options: AnalyOptions = {}) {
  const sent: AnalyEvent[] = [];
  const metas: SendMeta[] = [];
  const memory = {
    name: 'memory',
    send(events: AnalyEvent[], meta: SendMeta) {
      sent.push(...events);
      metas.push(meta);
    },
  };
  const analy = createAnaly({ batchSize: 1, ...options, sinks: [memory, ...(options.sinks ?? [])] });
  live.push(analy);
  return { analy, sent, metas, names: () => sent.map((e) => e.name) };
}

export function destroyAll(): void {
  live.splice(0).forEach((analy) => analy.destroy());
}

// The pageviews plugin wraps history and never unwraps (see its teardown), so tests put it back.
const originalHistory =
  typeof history === 'undefined' ? undefined : { pushState: history.pushState, replaceState: history.replaceState };

/** Destroys trackers and clears everything a test or fuzz run can leave behind. */
export function resetDom(): void {
  destroyAll();
  if (originalHistory) Object.assign(history, originalHistory);
  localStorage.clear();
  sessionStorage.clear();
  for (const cookie of document.cookie.split(';')) {
    const key = cookie.split('=')[0].trim();
    if (key) document.cookie = `${key}=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
  document.body.innerHTML = '';
  document.title = '';
  history.replaceState(null, '', '/');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
}

export function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * Makes localStorage, sessionStorage and document.cookie throw, as blocked site data or some private
 * modes do. Returns a function that puts the originals back.
 */
export function blockStorage(): () => void {
  const blocked = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  const targets: Array<[object, string]> = [
    [window, 'localStorage'],
    [window, 'sessionStorage'],
    [document, 'cookie'],
  ];
  // Some of these are own properties of window/document in happy-dom, others live on a prototype.
  const originals = targets.map(([target, name]) => Object.getOwnPropertyDescriptor(target, name));
  for (const [target, name] of targets) Object.defineProperty(target, name, { get: blocked, set: blocked, configurable: true });
  return () =>
    targets.forEach(([target, name], i) => {
      const original = originals[i];
      if (original) Object.defineProperty(target, name, original);
      else Reflect.deleteProperty(target, name);
    });
}

/** Marks a synthetic event as if a real user caused it. */
export function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

/** Stand-in for PerformanceObserver: tests push entries with FakeObserver.of(type).emit([...]). */
export class FakeObserver {
  static supportedEntryTypes = ['largest-contentful-paint', 'paint', 'layout-shift', 'event'];
  static instances: FakeObserver[] = [];
  static of(type: string): FakeObserver {
    return FakeObserver.instances.find((o) => o.type === type)!;
  }
  type = '';
  constructor(private readonly callback: (list: { getEntries(): unknown[] }) => void) {
    FakeObserver.instances.push(this);
  }
  observe({ type }: { type: string }) {
    this.type = type;
  }
  disconnect() {}
  emit(entries: object[]) {
    this.callback({ getEntries: () => entries });
  }
}

export function sampleEvent(overrides: Partial<AnalyEvent> = {}): AnalyEvent {
  return {
    schema: 1,
    id: '00000000-0000-4000-8000-000000000001',
    name: 'pageview',
    time: '2026-10-16T12:00:00.000Z',
    session: '00000000-0000-4000-8000-000000000002',
    page: { url: 'https://a.test/', path: '/', title: 'Home', viewId: '00000000-0000-4000-8000-000000000003' },
    device: { language: 'en', timezone: 'UTC', screen: '1x1', viewport: '1x1', touch: false, userAgent: 'ua' },
    props: {},
    ...overrides,
  };
}
