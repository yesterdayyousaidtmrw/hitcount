import { describe, expect, it } from 'vitest';
import { media } from '../src/plugins/media';
import { track } from './helpers';

/** A <video>/<audio> whose playback state the test drives; media events do not bubble, like the real ones. */
function player(tag: 'video' | 'audio', attributes = '') {
  document.body.insertAdjacentHTML('beforeend', `<${tag} ${attributes}></${tag}>`);
  const el = document.body.lastElementChild as HTMLMediaElement;
  const state = { currentTime: 0, duration: 100, ended: false, muted: false, src: 'https://cdn.test/media/intro.mp4?sig=1' };
  Object.defineProperty(el, 'currentTime', { get: () => state.currentTime, configurable: true });
  Object.defineProperty(el, 'duration', { get: () => state.duration, configurable: true });
  Object.defineProperty(el, 'ended', { get: () => state.ended, configurable: true });
  Object.defineProperty(el, 'muted', { get: () => state.muted, configurable: true });
  Object.defineProperty(el, 'currentSrc', { get: () => state.src, configurable: true });
  const fire = (type: string) => el.dispatchEvent(new Event(type));
  return { el, state, fire, at: (seconds: number) => { state.currentTime = seconds; fire('timeupdate'); } };
}

const actions = (sent: Array<{ props: Record<string, unknown> }>) => sent.map((e) => e.props.action);

describe('media', () => {
  it('reports play, progress milestones, pause and complete with watched time', () => {
    const { sent } = track({ plugins: [media()] });
    const video = player('video', 'data-analy="hero"');
    video.fire('play');
    for (let t = 1; t <= 30; t++) video.at(t);
    video.fire('pause');
    video.fire('play');
    for (let t = 31; t <= 100; t++) video.at(t);
    video.state.ended = true;
    video.fire('pause');
    video.fire('ended');

    expect(actions(sent)).toEqual(['play', 'progress', 'pause', 'play', 'progress', 'progress', 'complete']);
    expect(sent[0].props).toMatchObject({ kind: 'video', media: 'hero', src: 'https://cdn.test/media/intro.mp4?sig=1', duration: 100 });
    expect(sent[1].props).toMatchObject({ percent: 25 });
    expect(sent[2].props).toMatchObject({ position: 30, watchedSeconds: 30 });
    expect(sent[6].props).toMatchObject({ percent: 100, watchedSeconds: 100 });
  });

  it('does not count a seek as watched time', () => {
    const { sent } = track({ plugins: [media()] });
    const audio = player('audio', 'id="episode-12"');
    audio.fire('play');
    audio.at(1);
    audio.at(2);
    audio.at(90);
    audio.fire('pause');
    const pause = sent.find((e) => e.props.action === 'pause')!;
    expect(pause.props).toMatchObject({ kind: 'audio', media: 'episode-12', watchedSeconds: 2 });
    expect(actions(sent)).toEqual(['play', 'progress', 'progress', 'progress', 'pause']);
  });

  it('names media by file when it has no data-analy or id, and handles live streams', () => {
    const { sent } = track({ plugins: [media()] });
    const live = player('video');
    live.state.duration = Infinity;
    live.fire('play');
    expect(sent[0].props).toMatchObject({ media: 'intro.mp4', duration: null });
  });

  it('reports a stop for media still playing when the page is left', () => {
    const { sent } = track({ plugins: [media()] });
    const video = player('video', 'id="v"');
    video.fire('play');
    video.at(1);
    dispatchEvent(new Event('pagehide'));
    expect(actions(sent)).toEqual(['play', 'stop']);
  });

  it('skips decorative background video and data-analy-ignore', () => {
    const { sent } = track({ plugins: [media()] });
    const background = player('video', 'autoplay muted loop');
    background.state.muted = true;
    background.fire('play');
    player('audio', 'data-analy-ignore').fire('play');
    expect(sent).toHaveLength(0);
  });
});
