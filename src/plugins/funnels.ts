import type { FunnelStepProps } from '../events';
import type { Analy, AnalyEvent, Plugin } from '../types';

export interface FunnelsOptions {
  /**
   * Funnel name → its steps, in order. A step starting with / is a page path, matched against page
   * views: a trailing slash is ignored and * matches any run of characters. Any other step is an
   * event name.
   */
  funnels?: Record<string, string[]>;
}

type Matcher = (event: AnalyEvent) => boolean;

interface Funnel {
  name: string;
  steps: string[];
  matchers: Matcher[];
}

/** One session's place in one funnel, as kept in analy.store. start and last are event times in ms. */
interface Progress {
  session: string;
  step: number;
  start: number;
  last: number;
}

// page.path is percent-encoded (/%C3%BCber) and steps are written as people read them (/über), so
// both are compared decoded, without a trailing slash.
function decoded(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    // A malformed escape (a lone %) is compared as it is.
    return path;
  }
}
const comparable = (path: string) => decoded(path).replace(/\/+$/, '') || '/';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matcher(step: string): Matcher {
  // Its own events never count: one step reached could otherwise set off the next.
  if (step === 'funnel_step') return () => false;
  if (!step.startsWith('/')) return (event) => event.name === step;
  const pattern = new RegExp(`^${comparable(step).split('*').map(escapeRegExp).join('.*')}$`);
  return (event) => event.name === 'pageview' && pattern.test(comparable(event.page.path));
}

const isStepList = (steps: unknown): steps is string[] =>
  Array.isArray(steps) && steps.length > 0 && steps.every((step) => typeof step === 'string' && step);

// The funnels can come from the script tag's JSON, so anything that is not a list of paths and event
// names is left out rather than trusted.
function compile(declared: unknown): Funnel[] {
  if (!declared || typeof declared !== 'object') return [];
  return Object.entries(declared).flatMap(([name, steps]) =>
    isStepList(steps) ? [{ name, steps, matchers: steps.map(matcher) }] : [],
  );
}

const storeKey = (funnel: Funnel) => `funnel:${funnel.name}`;

// Stored progress counts only for this session and while it is short of the last step: reaching that
// clears it, so a larger step was saved under an older, longer declaration of the funnel.
const isProgress = (saved: Partial<Progress> | null, session: string, steps: number): saved is Progress =>
  saved?.session === session &&
  typeof saved.step === 'number' &&
  Number.isInteger(saved.step) &&
  saved.step >= 1 &&
  saved.step < steps &&
  Number.isInteger(saved.start) &&
  Number.isInteger(saved.last);

/** The session's progress in the funnel, or undefined when it has none. */
function progressIn(analy: Analy, funnel: Funnel, session: string): Progress | undefined {
  try {
    const saved = JSON.parse(analy.store.get(storeKey(funnel)) ?? 'null') as Partial<Progress> | null;
    return isProgress(saved, session, funnel.steps.length) ? saved : undefined;
  } catch {
    // Unreadable (edited by hand, say): the session starts the funnel afresh rather than failing the event.
    return undefined;
  }
}

// The visitor's clock can be set back mid-session; a step is never reported as reached before the last.
const elapsed = (from: number, to: number) => Math.max(0, to - from);

/** Moves the session on to the first step past its current one that the event matches, if any. */
function advance(analy: Analy, funnel: Funnel, event: AnalyEvent): FunnelStepProps | undefined {
  const progress = progressIn(analy, funnel, event.session);
  const current = progress?.step ?? 0;
  const step = funnel.matchers.findIndex((matches, i) => i >= current && matches(event)) + 1;
  if (!step) return undefined;
  const now = Date.parse(event.time);
  const start = progress?.start ?? now;
  const completed = step === funnel.steps.length;
  if (completed) analy.store.remove(storeKey(funnel));
  else analy.store.set(storeKey(funnel), JSON.stringify({ session: event.session, step, start, last: now }));
  return {
    funnel: funnel.name,
    step,
    stepName: funnel.steps[step - 1],
    steps: funnel.steps.length,
    skipped: step - current - 1,
    completed,
    msSinceStart: elapsed(start, now),
    msSincePrevious: progress ? elapsed(progress.last, now) : null,
  };
}

/**
 * Sends `funnel_step` each time a session reaches a step of a declared funnel beyond the furthest it
 * had reached, with how many steps it skipped, the time since its first and previous steps, and
 * whether the funnel is complete. Progress is kept per session in analy.store.
 */
export function funnels({ funnels: declared = {} }: FunnelsOptions = {}): Plugin {
  const list = compile(declared);
  return {
    name: 'funnels',
    // Steps are caught here rather than with a hook from setup: pageviews sends the first page view
    // from its own setup, which can run before this one.
    enrich(event, analy) {
      for (const funnel of list) {
        const props = advance(analy, funnel, event);
        // Progress is saved now, so the next event sees it, but funnel_step waits a microtask: the core
        // queues an event only after every enricher has run, so tracked from here it would reach the
        // sinks before the event that set it off. track() itself sends nothing once tracking is off.
        if (props) queueMicrotask(() => analy.track('funnel_step', props));
      }
      return event;
    },
  };
}
