import { beforeEach, describe, expect, it, vi } from 'vitest';
import { embeds } from '../src/plugins/embeds';
import { track } from './helpers';

const YOUTUBE = 'https://www.youtube.com';
const VIMEO = 'https://player.vimeo.com';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * An embed iframe whose player the test plays. happy-dom does not load cross-origin frames, so
 * contentWindow is a stand-in that records what the plugin posts to the player.
 */
function embed(src: string, attributes = '') {
  document.body.insertAdjacentHTML('beforeend', `<iframe src="${src}" ${attributes}></iframe>`);
  const iframe = document.body.lastElementChild as HTMLIFrameElement;
  const frame = { postMessage: vi.fn() };
  Object.defineProperty(iframe, 'contentWindow', { value: frame, configurable: true });
  return {
    iframe,
    /** [message, targetOrigin] for everything the plugin posted to the player, JSON strings parsed. */
    posted: () => frame.postMessage.mock.calls.map(([message, origin]) => [typeof message === 'string' ? JSON.parse(message) : message, origin]),
    /** A message from the player to the page. */
    post: (data: unknown, origin: string, source: unknown = frame) =>
      dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window })),
  };
}
type Embed = ReturnType<typeof embed>;

// The message shapes observed from live embeds; the protocol notes are in src/plugins/embeds.ts.
const youtube = (player: Embed, info: Record<string, unknown>, origin = YOUTUBE) =>
  player.post(JSON.stringify({ event: 'infoDelivery', info, channel: 'widget', id: 1 }), origin);
const vimeo = (player: Embed, event: string, data: Record<string, unknown> = {}) => player.post({ event, data }, VIMEO);

const actions = (sent: Array<{ props: Record<string, unknown> }>) => sent.map((e) => e.props.action);

describe('embeds', () => {
  beforeEach(() => {
    // happy-dom logs "Iframe page loading is disabled" for every cross-origin iframe it is handed.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('turns YouTube player state into play, progress, pause and complete', () => {
    const player = embed('https://www.youtube.com/embed/M7lc1UVf-VE?enablejsapi=1');
    const { sent } = track({ plugins: [embeds()] });
    youtube(player, { playerState: 5, currentTime: 0, duration: 100, muted: false });
    youtube(player, { playerState: 1, currentTime: 0 });
    for (let t = 0.25; t <= 30; t += 0.25) youtube(player, { currentTime: t });
    youtube(player, { playerState: 2, currentTime: 30 });
    youtube(player, { playerState: 1, currentTime: 30 });
    for (let t = 30.25; t <= 100; t += 0.25) youtube(player, { currentTime: t });
    youtube(player, { playerState: 0, currentTime: 100, duration: 100 });

    expect(actions(sent)).toEqual(['play', 'progress', 'pause', 'play', 'progress', 'progress', 'complete']);
    expect(sent[0].props).toEqual({
      action: 'play', kind: 'video', provider: 'youtube', media: 'M7lc1UVf-VE',
      src: 'https://www.youtube.com/embed/M7lc1UVf-VE?enablejsapi=1', position: 0, duration: 100, muted: false, watchedSeconds: 0,
    });
    expect(sent[1].props).toMatchObject({ percent: 25 });
    expect(sent[2].props).toMatchObject({ position: 30, watchedSeconds: 30 });
    expect(sent[6].props).toMatchObject({ percent: 100, watchedSeconds: 100 });
  });

  it('reports one play through buffering and repeated deliveries, and does not count a seek as watched', () => {
    const player = embed('https://www.youtube-nocookie.com/embed/abc123?enablejsapi=1', 'id="hero"');
    const { sent } = track({ plugins: [embeds()] });
    const nocookie = 'https://www.youtube-nocookie.com';
    youtube(player, { playerState: 1, currentTime: 0, duration: 600 }, nocookie);
    youtube(player, { playerState: 1, currentTime: 0.25 }, nocookie);
    youtube(player, { currentTime: 1, muted: true }, nocookie);
    youtube(player, { playerState: 3, currentTime: 400 }, nocookie);
    youtube(player, { playerState: 1, currentTime: 400 }, nocookie);
    youtube(player, { currentTime: 401 }, nocookie);
    youtube(player, { playerState: 2, currentTime: 401 }, nocookie);
    youtube(player, { playerState: 2, currentTime: 401 }, nocookie);

    expect(actions(sent)).toEqual(['play', 'progress', 'progress', 'pause']);
    expect(sent[3].props).toMatchObject({ media: 'hero', provider: 'youtube', muted: true, watchedSeconds: 2 });
  });

  it('turns Vimeo player events into the same media events', () => {
    const player = embed('https://player.vimeo.com/video/76979871', 'data-hitcount="launch film"');
    const { sent } = track({ plugins: [embeds()] });
    player.post({ method: 'getMuted', value: true }, VIMEO);
    vimeo(player, 'play', { seconds: 0, percent: 0, duration: 62 });
    for (let t = 0.25; t <= 30; t += 0.25) vimeo(player, 'timeupdate', { seconds: t, percent: t / 62, duration: 62 });
    vimeo(player, 'volumechange', { volume: 1, muted: false });
    vimeo(player, 'pause', { seconds: 30, percent: 0.484, duration: 62 });
    vimeo(player, 'play', { seconds: 30, percent: 0.484, duration: 62 });
    for (let t = 30.25; t <= 62; t += 0.25) vimeo(player, 'timeupdate', { seconds: t, percent: t / 62, duration: 62 });
    // Reaching the end posts pause (percent 1) and then ended; only ended is reported.
    vimeo(player, 'pause', { seconds: 62, percent: 1, duration: 62 });
    vimeo(player, 'ended', { seconds: 62, percent: 1, duration: 62 });

    expect(actions(sent)).toEqual(['play', 'progress', 'pause', 'play', 'progress', 'progress', 'complete']);
    expect(sent[0].props).toEqual({
      action: 'play', kind: 'video', provider: 'vimeo', media: 'launch film',
      src: 'https://player.vimeo.com/video/76979871', position: 0, duration: 62, muted: true, watchedSeconds: 0,
    });
    expect(sent[2].props).toMatchObject({ position: 30, muted: false, watchedSeconds: 30 });
    expect(sent[6].props).toMatchObject({ percent: 100, watchedSeconds: 62 });
  });

  it('asks each player to report: on start, when a later one loads, and when Vimeo says it is ready', () => {
    // youtube.com/embed redirects to www.youtube.com, which is where commands have to go.
    const early = embed('https://youtube.com/embed/early?enablejsapi=1');
    track({ plugins: [embeds()] });
    expect(early.posted()).toEqual([[{ event: 'listening', id: 'hitcount', channel: 'widget' }, YOUTUBE]]);

    const later = embed('https://player.vimeo.com/video/1084537');
    expect(later.posted()).toEqual([]);
    later.iframe.dispatchEvent(new Event('load'));
    const subscribe = [
      ...['play', 'pause', 'ended', 'timeupdate', 'volumechange'].map((value) => [{ method: 'addEventListener', value }, VIMEO]),
      [{ method: 'getMuted' }, VIMEO],
    ];
    expect(later.posted()).toEqual(subscribe);
    later.post('{"event":"ready"}', VIMEO);
    expect(later.posted()).toEqual([...subscribe, ...subscribe]);
  });

  it("does not take over a loaded YouTube player that the page's own iframe API may be driving", () => {
    // YouTube answers whoever sent "listening" last; asking after a page's YT.Player leaves it deaf.
    vi.stubGlobal('YT', {});
    const player = embed('https://www.youtube.com/embed/abc?enablejsapi=1', 'id="player"');
    const { sent } = track({ plugins: [embeds()] });
    expect(player.posted()).toEqual([]);
    // Asking as the frame loads is safe: the page's own load handlers run after, so they ask last.
    player.iframe.dispatchEvent(new Event('load'));
    expect(player.posted()).toEqual([[{ event: 'listening', id: 'hitcount', channel: 'widget' }, YOUTUBE]]);
    // Whichever client the player answers, it posts to the page, so the events are seen either way.
    player.post(JSON.stringify({ event: 'infoDelivery', info: { playerState: 1, currentTime: 0, duration: 10 }, id: 1 }), YOUTUBE);
    expect(sent[0].props).toMatchObject({ action: 'play', media: 'player', provider: 'youtube' });
  });

  it('believes only the provider, speaking from a known player', () => {
    const player = embed('https://player.vimeo.com/video/1');
    const other = embed('https://example.test/player.html');
    // A frame happy-dom never loaded has a null contentWindow, like a detached one in a browser.
    document.body.insertAdjacentHTML('beforeend', '<iframe src="https://player.vimeo.com/video/2"></iframe>');
    const { sent } = track({ plugins: [embeds()] });
    const play = { event: 'play', data: { seconds: 0, duration: 10 } };
    player.post(play, 'https://evil.test');
    player.post(play, YOUTUBE);
    player.post(play, VIMEO, window);
    player.post(play, VIMEO, null);
    other.post(play, VIMEO);
    expect(sent).toEqual([]);
    player.post(play, VIMEO);
    expect(actions(sent)).toEqual(['play']);
  });

  it('ignores what it cannot read, without throwing', () => {
    const yt = embed('https://www.youtube.com/embed/abc?enablejsapi=1');
    const vm = embed('https://player.vimeo.com/video/1');
    const { sent } = track({ plugins: [embeds()] });
    for (const data of ['{not json', '', 'null', '42', null, 42, [], { event: 'infoDelivery', info: null }, { event: 42, info: 'x' }]) {
      yt.post(data, YOUTUBE);
      vm.post(data, VIMEO);
    }
    youtube(yt, { playerState: '1', currentTime: 'soon', duration: -1 });
    expect(sent).toEqual([]);
    vimeo(vm, 'play', { seconds: Number.NaN, duration: Number.POSITIVE_INFINITY });
    expect(sent[0].props).toMatchObject({ action: 'play', position: 0, duration: null });
  });

  it('reports a stop for an embed still playing when the page is left', () => {
    const player = embed('https://player.vimeo.com/video/1');
    const { sent } = track({ plugins: [embeds()] });
    vimeo(player, 'play', { seconds: 3, percent: 0.05, duration: 60 });
    dispatchEvent(new Event('pagehide'));
    expect(actions(sent)).toEqual(['play', 'stop']);
    expect(sent[1].props).toMatchObject({ provider: 'vimeo', position: 3 });
  });

  it('skips data-hitcount-ignore', () => {
    const player = embed('https://player.vimeo.com/video/1', 'data-hitcount-ignore');
    const { sent } = track({ plugins: [embeds()] });
    player.iframe.dispatchEvent(new Event('load'));
    vimeo(player, 'play', { seconds: 0, duration: 10 });
    expect(player.posted()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('enableApi adds enablejsapi=1 and origin to YouTube iframes that lack it, including later ones', async () => {
    const plain = embed('https://www.youtube.com/embed/abc?rel=0');
    const ready = embed('https://www.youtube.com/embed/def?enablejsapi=1');
    const film = embed('https://player.vimeo.com/video/1');
    track({ plugins: [embeds({ enableApi: true })] });
    const params = (iframe: HTMLIFrameElement) => Object.fromEntries(new URL(iframe.src).searchParams);
    expect(params(plain.iframe)).toEqual({ rel: '0', enablejsapi: '1', origin: 'http://localhost:3000' });
    expect(ready.iframe.src).toBe('https://www.youtube.com/embed/def?enablejsapi=1');
    expect(film.iframe.src).toBe('https://player.vimeo.com/video/1');

    const later = embed('https://www.youtube-nocookie.com/embed/ghi');
    await settle();
    expect(params(later.iframe)).toEqual({ enablejsapi: '1', origin: 'http://localhost:3000' });
  });

  it('leaves YouTube iframes as they are without enableApi', async () => {
    const plain = embed('https://www.youtube.com/embed/abc');
    track({ plugins: [embeds()] });
    embed('https://www.youtube.com/embed/def');
    await settle();
    expect(plain.iframe.src).toBe('https://www.youtube.com/embed/abc');
    expect(document.querySelectorAll('iframe')[1].src).toBe('https://www.youtube.com/embed/def');
  });
});
