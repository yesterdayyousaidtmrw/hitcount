import { readFileSync } from 'node:fs';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  channels, clicks, cloudflare, deadclicks, device, embeds, engagement, errors, fingerprint, forms, funnels, heatmap,
  media, pageviews, rageclicks, search, sections, toRow, traffic, turnstile, vitals,
} from '../src/index';
import type { HitcountEvent } from '../src/types';
import { FakeIntersectionObserver, FakeObserver, sampleEvent, setVisibility, track, trusted } from './helpers';

// The generated docs are only useful if real plugin output matches them. This drives every
// plugin through one visit and checks each event against schema/event.v1.json and each row
// against schema/row.v1.json.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const eventSchema = readJson('schema/event.v1.json');
const validateEvent = ajv.compile(eventSchema);
const validateRow = ajv.compile(readJson('schema/row.v1.json'));
const problems = (validate: ValidateFunction, data: unknown) => (validate(data) ? '' : ajv.errorsText(validate.errors));
const builtInNames: string[] = eventSchema.allOf.map((rule: { if: { properties: { name: { const: string } } } }) => rule.if.properties.name.const);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = (el: Element, init: MouseEventInit = {}) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init }));

async function oneVisitWithEverything(): Promise<HitcountEvent[]> {
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('colo=LHR\nloc=GB\nip=203.0.113.7\nhttp=http/2\ntls=TLSv1.3\nwarp=off\n')));
  history.replaceState(null, '', '/pricing?utm_source=chatgpt.com&q=shoes');
  document.body.innerHTML = `
    <a id="out" href="https://other.test/x">out</a>
    <a id="file" href="/guide.pdf">pdf</a>
    <a id="mail" href="mailto:hi@example.com">mail</a>
    <button id="buy" data-hitcount="buy" data-hitcount-plan="pro">buy</button>
    <form id="signup"><input name="email"><input name="age" type="number" required></form>
    <div id="captcha"><div><div></div><input type="hidden" name="cf-turnstile-response"></div></div>
    <video id="clip" src="https://cdn.test/clip.mp4"></video>
    <section id="plans" data-hitcount-view="plans"></section>
    <span id="inert" role="button">does nothing</span>
    <p data-hitcount-results="12">12 results</p>
    <iframe id="talk" srcdoc="" src="https://player.vimeo.com/video/76979871"></iframe>`;
  document.addEventListener('click', (e) => e.preventDefault(), { once: false });

  const { hitcount, sent } = track({
    plugins: [
      pageviews(), engagement(), clicks(), forms(), traffic(), device(), channels(), rageclicks(), heatmap(),
      errors(), vitals(), media(), embeds(), turnstile(), cloudflare(), search(), sections({ visibleMs: 0 }),
      deadclicks({ waitMs: 0 }), fingerprint(), funnels({ funnels: { buy: ['/pricing', 'buy'] } }),
    ],
  });
  const $ = (selector: string) => document.querySelector(selector)!;
  click($('#out'));
  click($('#file'));
  click($('#mail'));
  for (let i = 0; i < 3; i++) click($('#buy'), { clientX: 5, clientY: 5 });
  const email = $('[name=email]') as HTMLInputElement;
  email.value = 'jane@example.com';
  email.dispatchEvent(new Event('input', { bubbles: true }));
  email.dispatchEvent(new Event('change', { bubbles: true }));
  ($('[name=age]') as HTMLInputElement).checkValidity();
  dispatchEvent(new ErrorEvent('error', { message: 'boom', filename: 'https://a.test/app.js', lineno: 1, colno: 2, error: new Error('boom') }));
  $('#captcha input').setAttribute('value', 'XXXX.DUMMY.TOKEN.XXXX');
  const clip = $('#clip') as HTMLMediaElement;
  Object.defineProperty(clip, 'duration', { value: 20, configurable: true });
  for (const [type, at] of [['play', 0], ['timeupdate', 1], ['timeupdate', 6], ['ended', 20]] as const) {
    Object.defineProperty(clip, 'currentTime', { value: at, configurable: true });
    clip.dispatchEvent(new Event(type));
  }
  // srcdoc keeps happy-dom from trying to load the player; its window stands in for Vimeo's.
  const talk = ($('#talk') as HTMLIFrameElement).contentWindow!;
  for (const [event, seconds] of [['play', 0], ['timeupdate', 1], ['timeupdate', 6], ['ended', 20]] as const) {
    const data = { event, data: { seconds, percent: seconds / 20, duration: 20 } };
    dispatchEvent(new MessageEvent('message', { data, origin: 'https://player.vimeo.com', source: talk }));
  }
  FakeObserver.of('largest-contentful-paint').emit([{ startTime: 900 }]);
  FakeObserver.of('event').emit([{ interactionId: 1, duration: 80 }]);
  dispatchEvent(trusted(new PointerEvent('pointermove')));
  hitcount.identify('user-1', { plan: 'pro' });
  await settle();
  // After the settle, so no earlier DOM change counts as the page reacting to this click.
  FakeIntersectionObserver.show($('#plans'), 1);
  click($('#inert'));
  await settle();
  setVisibility('hidden');
  dispatchEvent(new Event('pagehide'));
  return sent;
}

describe('generated schemas match what the plugins send', () => {
  let sent: HitcountEvent[] = [];
  beforeAll(async () => {
    sent = await oneVisitWithEverything();
  });

  it('every event validates against schema/event.v1.json', () => {
    const failures = sent.map((event) => ({ name: event.name, errors: problems(validateEvent, event) })).filter((f) => f.errors);
    expect(failures).toEqual([]);
  });

  it('every built-in event name was exercised', () => {
    const seen = new Set(sent.map((e) => e.name));
    expect(builtInNames.filter((name) => !seen.has(name))).toEqual([]);
  });

  it('every event carries where the visit started', () => {
    const landing = { channel: 'ai', name: 'chatgpt.com', landing: '/pricing', utm: { source: 'chatgpt.com' } };
    expect(sent.map((e) => e.attribution)).toEqual(sent.map(() => landing));
  });

  it('the visit includes an embedded player, so its provider prop is checked too', () => {
    expect(sent.filter((e) => e.name === 'media' && e.props.provider === 'vimeo').length).toBeGreaterThan(0);
  });

  it('every row validates against schema/row.v1.json', () => {
    const failures = sent.map((event) => ({ name: event.name, errors: problems(validateRow, toRow(event)) })).filter((f) => f.errors);
    expect(failures).toEqual([]);
  });

  it('accepts a server-issued visitor id that is not a uuid', () => {
    const event = sampleEvent({ visitor: 'srv.v1.abc' });
    expect(problems(validateEvent, event)).toBe('');
    expect(problems(validateRow, toRow(event))).toBe('');
  });

  it('rejects a built-in event whose props break the contract', () => {
    expect(validateEvent(sampleEvent({ name: 'engagement', props: { activeMs: 'soon' } }))).toBe(false);
  });
});
