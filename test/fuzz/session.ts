import { vi } from 'vitest';
import { createAnaly } from '../../src/core/tracker';
import type { AnalyEvent, Consent, Sink } from '../../src/types';
import { blockStorage, FakeIntersectionObserver, FakeObserver, setVisibility, trusted } from '../helpers';
import { type FuzzConfig, makePlugins } from './config';
import type { Rng } from './rng';
import { randomProps, randomUrl, SECRET_EMAIL, SECRET_TOKEN } from './values';

// The player iframes carry srcdoc so happy-dom gives them a window without trying to load the player.
const PAGE = `
  <a id="out" href="https://other.test/path?token=${SECRET_TOKEN}&ref=x">out</a>
  <a id="file" href="/files/${SECRET_EMAIL}.pdf">file</a>
  <a id="mail" href="mailto:${SECRET_EMAIL}">mail</a>
  <a id="tel" href="tel:+15550001">tel</a>
  <a id="internal" href="/about">about</a>
  <button id="cta" data-analy="cta" data-analy-plan="pro" data-analy-who="${SECRET_EMAIL}">cta</button>
  <div id="plain" class="a b c">plain</div>
  <form id="signup" data-analy="signup"><input name="email" type="email" required><input name="password" type="password"></form>
  <section id="pricing" data-analy-view="pricing">pricing</section>
  <video id="clip"></video>
  <iframe srcdoc="" src="https://www.youtube.com/embed/${SECRET_EMAIL}?enablejsapi=1&token=${SECRET_TOKEN}"></iframe>
  <iframe srcdoc="" src="https://player.vimeo.com/video/76979871?token=${SECRET_TOKEN}"></iframe>`;

export interface CustomCall {
  name: string;
  consent: Consent;
  /** Tracking was on: no respected privacy signal and not destroyed. */
  live: boolean;
}

export interface Outcome {
  sent: AnalyEvent[];
  errors: Array<{ source: string; error: unknown }>;
  thrown: unknown[];
  custom: CustomCall[];
  /** Consent changes; `after` is how many custom calls came before the change. */
  timeline: Array<{ after: number; state: Consent }>;
  enabled: boolean;
  /** sent.length right after destroy(), or -1 if the session never destroyed the tracker. */
  sentAtDestroy: number;
  storage: { local: string[]; session: string[]; cookies: string };
}

function extraSink(kind: FuzzConfig['extraSink']): Sink[] {
  if (kind === 'throws') return [{ name: 'fuzz-throws', send: () => { throw new Error('sink exploded'); } }];
  if (kind === 'rejects') return [{ name: 'fuzz-rejects', send: () => Promise.reject(new Error('sink rejected')) }];
  return [];
}

function analyKeys(read: () => Storage): string[] {
  try {
    const storage = read();
    return Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? '').filter((k) => k.startsWith('_analy'));
  } catch {
    // Blocked storage: nothing can have been written to it.
    return [];
  }
}

/** One random visit under one config. Never throws: everything that goes wrong lands in the outcome. */
export async function runSession(rng: Rng, config: FuzzConfig): Promise<Outcome> {
  vi.useFakeTimers();
  FakeObserver.instances = [];
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  const restore: Array<() => void> = [];
  if (config.privacySignal === 'gpc') {
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    restore.push(() => Reflect.deleteProperty(navigator, 'globalPrivacyControl'));
  }
  if (config.privacySignal === 'dnt') {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    restore.push(() => Reflect.deleteProperty(navigator, 'doNotTrack'));
  }
  const stopNavigation = (event: Event) => event.preventDefault();
  document.addEventListener('click', stopNavigation);
  restore.push(() => document.removeEventListener('click', stopNavigation));
  history.replaceState(null, '', randomUrl(rng));
  document.title = rng.pick(['Home', `Inbox ${SECRET_EMAIL}`, '']);
  document.body.innerHTML = PAGE;
  if (config.storageBlocked) restore.push(blockStorage());

  const outcome: Outcome = {
    sent: [], errors: [], thrown: [], custom: [], timeline: [],
    enabled: !(config.privacySignal !== 'none' && config.respectPrivacySignals),
    sentAtDestroy: -1,
    storage: { local: [], session: [], cookies: '' },
  };
  let consent = config.consent;
  let destroyed = false;
  let counter = 0;
  let widgets = 0;
  let lateSections = 0;

  const analy = createAnaly({
    site: 'fuzz',
    persist: config.persist,
    consent: config.consent,
    respectPrivacySignals: config.respectPrivacySignals,
    batchSize: config.batchSize,
    sinks: [{ name: 'record', send: (events) => void outcome.sent.push(...events) }, ...extraSink(config.extraSink)],
    plugins: makePlugins(config.plugins),
    beforeSend:
      config.beforeSend === 'drop'
        ? (e) => (e.name.startsWith('fz_') && e.name.endsWith('3') ? null : e)
        : config.beforeSend === 'mutate'
          ? (e) => ({ ...e, props: { ...e.props, mutated: true } })
          : undefined,
    onError: (error, source) => outcome.errors.push({ source, error }),
  });

  const click = () => {
    const targets = Array.from(document.querySelectorAll('a, button, #plain, input, [id^="ts"] [tabindex]'));
    const init = { bubbles: true, cancelable: true, detail: rng.int(0, 2), clientX: rng.int(0, 400), clientY: rng.int(0, 400) };
    const event = new MouseEvent('click', init);
    rng.pick(targets).dispatchEvent(rng.chance(0.5) ? trusted(event) : event);
  };
  // One step of filling the form, in any order, including ones no real visitor could produce.
  const formStep = () => {
    const form = document.querySelector('form')!;
    const field = form.querySelector<HTMLInputElement>(rng.pick(['[name=email]', '[name=password]']))!;
    const step = rng.pick(['focusin', 'input', 'change', 'focusout', 'invalid', 'submit', 'hide'] as const);
    if (step === 'focusin' || step === 'focusout') field.dispatchEvent(new FocusEvent(step, { bubbles: true, composed: true }));
    else if (step === 'input' || step === 'change') {
      field.value = rng.pick([SECRET_EMAIL, 'hunter2', '']);
      field.dispatchEvent(new Event(step, { bubbles: true, composed: step === 'input' }));
    } else if (step === 'invalid') field.checkValidity();
    else if (step === 'submit') form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    else {
      setVisibility('hidden');
      setVisibility('visible');
    }
  };
  const turnstileStep = () => {
    const existing = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
    if (!existing || rng.chance(0.3)) {
      document.body.insertAdjacentHTML('beforeend', `<div id="ts${++widgets}"><div><div tabindex="0"></div><input type="hidden" name="cf-turnstile-response"></div></div>`);
    } else existing.setAttribute('value', existing.value ? '' : 'XXXX.DUMMY.TOKEN.XXXX');
  };
  const vitalsStep = () => {
    FakeObserver.instances.find((o) => o.type === 'layout-shift')?.emit([{ startTime: rng.int(0, 9000), value: rng.next() / 5 }]);
    FakeObserver.instances.find((o) => o.type === 'largest-contentful-paint')?.emit([{ startTime: rng.int(100, 5000) }]);
    FakeObserver.instances.find((o) => o.type === 'event')?.emit([{ interactionId: 1, duration: rng.int(8, 900) }]);
  };

  const mediaStep = () => {
    const video = document.querySelector('video')!;
    const duration = rng.pick([30, 600, Infinity, NaN]);
    const position = Number.isFinite(duration) ? rng.next() * duration : rng.int(0, 100);
    Object.defineProperty(video, 'duration', { value: duration, configurable: true });
    Object.defineProperty(video, 'currentTime', { value: position, configurable: true });
    Object.defineProperty(video, 'currentSrc', { value: `https://cdn.test/${SECRET_EMAIL}/clip.mp4?token=${SECRET_TOKEN}`, configurable: true });
    video.dispatchEvent(new Event(rng.pick(['play', 'timeupdate', 'timeupdate', 'pause', 'ended', 'error'])));
  };
  // Scrolls a section in or out of view; sometimes adds one first, as a lazy-loaded block would.
  const sectionStep = () => {
    if (rng.chance(0.2)) document.body.insertAdjacentHTML('beforeend', `<div data-analy-view="late-${++lateSections}">late</div>`);
    const sections = Array.from(document.querySelectorAll('[data-analy-view]'));
    FakeIntersectionObserver.show(rng.pick(sections), rng.pick([0, 0.2, 0.5, 1]));
  };

  // A few messages shaped like YouTube's and Vimeo's, with broken values, junk, a foreign origin or
  // the page itself as the sender mixed in.
  const embedMessage = () => {
    const frame = rng.pick(Array.from(document.querySelectorAll('iframe')));
    const youtube = frame.src.includes('youtube');
    const seconds = rng.pick([0, 1, 30, 599.9, -1, Number.NaN, Number.POSITIVE_INFINITY, '12']);
    const duration = rng.pick([600, 600, 0, -5, Number.POSITIVE_INFINITY, Number.NaN, 'long']);
    const data = youtube
      ? rng.pick([
          JSON.stringify({
            event: rng.pick(['infoDelivery', 'infoDelivery', 'initialDelivery', 'onReady']),
            info: { playerState: rng.pick([-1, 0, 1, 1, 2, 3, 5, '1']), currentTime: seconds, duration, muted: rng.chance(0.3) },
            id: rng.pick([1, 'analy']),
          }),
          '{not json',
          'null',
        ])
      : rng.pick([
          {
            event: rng.pick(['ready', 'play', 'pause', 'ended', 'timeupdate', 'timeupdate', 'volumechange']),
            data: { seconds, duration, percent: rng.pick([0, 0.5, 1]), volume: rng.pick([0, 1]), muted: rng.chance(0.5) },
          },
          { method: 'getMuted', value: rng.chance(0.5) },
          '{"event":"ready"}',
          null,
        ]);
    const origin = rng.chance(0.9) ? (youtube ? 'https://www.youtube.com' : 'https://player.vimeo.com') : 'https://evil.test';
    dispatchEvent(new MessageEvent('message', { data, origin, source: rng.chance(0.9) ? frame.contentWindow : window }));
  };
  const embedStep = () => {
    for (let i = rng.int(1, 4); i > 0; i--) embedMessage();
  };

  const actions: Array<[number, () => unknown]> = [
    [20, () => {
      const name = `fz_${++counter}`;
      outcome.custom.push({ name, consent, live: outcome.enabled && !destroyed });
      analy.track(name, randomProps(rng));
    }],
    [8, () => history.pushState(null, '', randomUrl(rng))],
    [4, () => analy.page(randomProps(rng))],
    [3, () => analy.identify(rng.pick(['u1', 'u2', 'user-3']), randomProps(rng))],
    [3, () => analy.reset()],
    [4, () => analy.set(randomProps(rng))],
    [6, () => {
      consent = rng.pick(['granted', 'pending', 'denied'] as const);
      outcome.timeline.push({ after: outcome.custom.length, state: consent });
      analy.consent(consent);
    }],
    [14, click],
    [8, formStep],
    [4, () => { for (let i = rng.int(1, 30); i > 0; i--) dispatchEvent(trusted(new PointerEvent('pointermove'))); }],
    [3, () => dispatchEvent(new Event('scroll'))],
    [5, () => { setVisibility('hidden'); if (rng.chance(0.7)) setVisibility('visible'); }],
    [2, () => dispatchEvent(new Event('pagehide'))],
    [3, () => dispatchEvent(new ErrorEvent('error', { message: rng.pick(['boom', `no user ${SECRET_EMAIL}`]), error: new Error('x') }))],
    [3, turnstileStep],
    [2, vitalsStep],
    [4, mediaStep],
    [4, sectionStep],
    [4, embedStep],
    [5, () => vi.advanceTimersByTimeAsync(rng.pick([0, 50, 1000, 5000, 31 * 60_000]))],
    [2, () => analy.flush()],
    [1, () => {
      analy.destroy();
      destroyed = true;
      outcome.sentAtDestroy = outcome.sent.length;
    }],
  ];
  const total = actions.reduce((sum, [weight]) => sum + weight, 0);
  const pickAction = () => {
    let roll = rng.next() * total;
    for (const [weight, action] of actions) if ((roll -= weight) < 0) return action;
    return actions[0][1];
  };

  for (let step = rng.int(5, 40); step > 0; step--) {
    try {
      await pickAction()();
      // Lets MutationObserver callbacks and resolved fetches run between actions.
      await Promise.resolve();
    } catch (error) {
      outcome.thrown.push(error);
    }
  }
  try {
    await vi.runOnlyPendingTimersAsync();
    analy.flush();
    await Promise.resolve();
  } catch (error) {
    outcome.thrown.push(error);
  }

  outcome.storage = {
    local: analyKeys(() => localStorage),
    session: analyKeys(() => sessionStorage),
    cookies: (() => {
      try {
        return document.cookie;
      } catch {
        return '';
      }
    })(),
  };
  if (!destroyed) analy.destroy();
  restore.reverse().forEach((undo) => undo());
  vi.useRealTimers();
  return outcome;
}
