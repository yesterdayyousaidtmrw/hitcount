import { describe, expect, it, vi } from 'vitest';
import { funnels } from '../src/plugins/funnels';
import { pageviews } from '../src/plugins/pageviews';
import type { HitcountEvent, HitcountOptions } from '../src/types';
import { track } from './helpers';

const T0 = Date.parse('2026-10-16T12:00:00.000Z');
const SIGNUP = { signup: ['/pricing', '/signup', 'signup_completed'] };

const stepEvents = (sent: HitcountEvent[]) => sent.filter((e) => e.name === 'funnel_step');
const funnelSteps = (sent: HitcountEvent[]) => stepEvents(sent).map((e) => e.props);
// funnel_step is tracked as soon as the event that reached the step is queued; this lets any stray
// microtask run before the assertions.
const settle = () => Promise.resolve();

/** A tracker running only the funnels plugin, on a fake clock: view and event take ms since T0. */
function tracker(declared: Record<string, string[]>, options: HitcountOptions = {}) {
  vi.useFakeTimers({ now: T0 });
  const tracked = track({ ...options, plugins: [funnels({ funnels: declared })] });
  const at = (ms: number) => vi.setSystemTime(T0 + ms);
  const view = (ms: number, path: string) => {
    at(ms);
    history.replaceState(null, '', path);
    tracked.hitcount.page();
  };
  const event = (ms: number, name: string) => {
    at(ms);
    tracked.hitcount.track(name);
  };
  return { ...tracked, at, view, event };
}

describe('funnels plugin', () => {
  it('sends each step reached with its place, timing and completion', async () => {
    const { sent, view, event } = tracker(SIGNUP);
    view(0, '/pricing');
    view(5000, '/signup');
    event(12_000, 'signup_completed');
    await settle();
    expect(funnelSteps(sent)).toEqual([
      { funnel: 'signup', step: 1, stepName: '/pricing', steps: 3, skipped: 0, completed: false, msSinceStart: 0, msSincePrevious: null },
      { funnel: 'signup', step: 2, stepName: '/signup', steps: 3, skipped: 0, completed: false, msSinceStart: 5000, msSincePrevious: 5000 },
      { funnel: 'signup', step: 3, stepName: 'signup_completed', steps: 3, skipped: 0, completed: true, msSinceStart: 12_000, msSincePrevious: 7000 },
    ]);
  });

  it('counts the steps skipped and ignores a step at or before the one reached', async () => {
    const { sent, view } = tracker({ tour: ['/a', '/b', '/c', '/d'] });
    view(0, '/a');
    view(1000, '/c');
    view(2000, '/b');
    view(3000, '/c');
    view(4000, '/a');
    view(6000, '/d');
    await settle();
    expect(funnelSteps(sent).map(({ step, skipped, completed, msSincePrevious }) => ({ step, skipped, completed, msSincePrevious }))).toEqual([
      { step: 1, skipped: 0, completed: false, msSincePrevious: null },
      { step: 3, skipped: 1, completed: false, msSincePrevious: 1000 },
      { step: 4, skipped: 0, completed: true, msSincePrevious: 5000 },
    ]);
  });

  it('can be entered again once completed, at any step', async () => {
    const { sent, view, event } = tracker(SIGNUP);
    view(0, '/pricing');
    event(1000, 'signup_completed');
    view(5000, '/signup');
    view(6000, '/pricing');
    event(9000, 'signup_completed');
    await settle();
    expect(funnelSteps(sent).map(({ step, skipped, completed, msSinceStart }) => ({ step, skipped, completed, msSinceStart }))).toEqual([
      { step: 1, skipped: 0, completed: false, msSinceStart: 0 },
      { step: 3, skipped: 1, completed: true, msSinceStart: 1000 },
      { step: 2, skipped: 1, completed: false, msSinceStart: 0 },
      { step: 3, skipped: 0, completed: true, msSinceStart: 4000 },
    ]);
  });

  it('starts over when the session changes', async () => {
    const { sent, view } = tracker(SIGNUP);
    view(0, '/pricing');
    await settle();
    view(31 * 60_000, '/signup');
    await settle();
    const [first, second] = stepEvents(sent);
    expect([first, second].map((e) => [e.props.step, e.props.skipped, e.props.msSinceStart, e.props.msSincePrevious])).toEqual([
      [1, 0, 0, null],
      [2, 1, 0, null],
    ]);
    expect(second.session).not.toBe(first.session);
  });

  it('files a step under the session of the event that reached it, even if the session ends right after', async () => {
    const { hitcount, sent, view } = tracker(SIGNUP);
    view(0, '/pricing');
    hitcount.reset();
    await settle();
    const [pageview, step] = sent;
    expect([pageview.name, step?.name]).toEqual(['pageview', 'funnel_step']);
    expect(step.session).toBe(pageview.session);
  });

  it('matches paths ignoring a trailing slash, with * for any run of characters', async () => {
    const { sent, view } = tracker({ docs: ['/', '/docs/*/intro', '/v1.0/', '/über'] });
    for (const path of ['/x', '/?q=1', '/docs/intro', '/docs/a/b/intro/', '/v1x0', '/v1.0', '/%C3%BCber']) view(0, path);
    await settle();
    expect(funnelSteps(sent).map((p) => p.stepName)).toEqual(['/', '/docs/*/intro', '/v1.0/', '/über']);
  });

  it('matches a path step on page views only and an event step by name, never funnel_step itself', async () => {
    const { sent, view, event } = tracker({ shop: ['/cart', 'checkout', '/checkout'], meta: ['funnel_step', 'done'] });
    // No page view yet: this event is on /cart but only its name can match.
    history.replaceState(null, '', '/cart');
    event(0, 'checkout');
    view(1000, '/checkout');
    await settle();
    event(2000, 'done');
    await settle();
    expect(funnelSteps(sent).map(({ funnel, step, skipped, completed }) => ({ funnel, step, skipped, completed }))).toEqual([
      { funnel: 'shop', step: 2, skipped: 1, completed: false },
      { funnel: 'shop', step: 3, skipped: 0, completed: true },
      { funnel: 'meta', step: 2, skipped: 1, completed: true },
    ]);
  });

  it('sends funnel_step after the event that reached the step, the first page view from pageviews included', async () => {
    history.replaceState(null, '', '/pricing');
    const { sent, names, hitcount } = track({ plugins: [pageviews(), funnels({ funnels: SIGNUP })] });
    hitcount.track('signup_completed');
    await settle();
    expect(names()).toEqual(['pageview', 'funnel_step', 'signup_completed', 'funnel_step']);
    expect(stepEvents(sent).map((e) => e.page.viewId)).toEqual([sent[0].page.viewId, sent[0].page.viewId]);
  });

  it('works out steps from events held for consent once it is granted, timed by when they happened', async () => {
    const { hitcount, sent, names, at, view, event } = tracker(SIGNUP, { consent: 'pending' });
    view(0, '/pricing');
    view(3000, '/signup');
    await settle();
    expect(sent).toEqual([]);
    at(60_000);
    hitcount.consent('granted');
    await settle();
    event(61_000, 'signup_completed');
    await settle();
    expect(names()).toEqual(['pageview', 'funnel_step', 'pageview', 'funnel_step', 'signup_completed', 'funnel_step']);
    expect(funnelSteps(sent).map(({ step, msSinceStart, msSincePrevious }) => [step, msSinceStart, msSincePrevious])).toEqual([
      [1, 0, null],
      [2, 3000, 3000],
      [3, 61_000, 58_000],
    ]);
    expect(new Set(sent.map((e) => e.session)).size).toBe(1);
  });

  it('starts afresh from stored progress it cannot read, without failing the event', async () => {
    const onError = vi.fn();
    const { hitcount, sent, names, view } = tracker(SIGNUP, { onError });
    const session = hitcount.ids().session;
    for (const stored of ['{not json', 'null', JSON.stringify({ session, step: 'two', start: T0, last: T0 })]) {
      hitcount.store.set('funnel:signup', stored);
      view(0, '/signup');
    }
    await settle();
    expect(names().filter((name) => name === 'pageview')).toHaveLength(3);
    expect(funnelSteps(sent).map(({ step, skipped, msSincePrevious }) => [step, skipped, msSincePrevious])).toEqual([
      [2, 1, null],
      [2, 1, null],
      [2, 1, null],
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('leaves out funnels that are not a list of steps', async () => {
    const declared = { text: '/a', empty: [], mixed: ['/a', 5], blank: ['/a', ''], ok: ['/a', '/b'] };
    const { sent, view } = tracker(declared as unknown as Record<string, string[]>);
    view(0, '/a');
    await settle();
    expect(funnelSteps(sent).map((p) => p.funnel)).toEqual(['ok']);
  });

  it('sends nothing once destroyed', async () => {
    const { hitcount, sent, view } = tracker(SIGNUP);
    view(0, '/pricing');
    hitcount.destroy();
    view(1000, '/signup');
    await settle();
    expect(funnelSteps(sent).map((props) => props.step)).toEqual([1]);
  });
});
