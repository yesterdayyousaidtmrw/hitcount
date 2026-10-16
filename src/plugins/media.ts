import type { MediaProps } from '../events';
import type { Plugin } from '../types';
import { ATTRIBUTE } from '../core/dom';

export interface MediaOptions {
  /** Progress milestones, in percent. Default [25, 50, 75]. */
  milestones?: number[];
}

interface Watch {
  watchedSeconds: number;
  lastTime: number;
  reached: Set<number>;
}

const EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'error'];
// timeupdate fires about every 250 ms; a bigger jump between two of them is a seek, not playback.
const MAX_STEP_SECONDS = 1.5;

const round = (n: number) => Math.round(n * 10) / 10;
const fileName = (src: string) => src.split(/[?#]/)[0].split('/').pop() ?? '';

/**
 * <video> and <audio> as `media` events: play, pause, progress milestones, complete, error, and
 * stop when the page is left mid-play, each with position and real watched time. Name a player
 * with data-analy; skip one with data-analy-ignore. Muted looping autoplay (background video) is
 * skipped automatically. Embedded YouTube/Vimeo players are iframes and are not seen.
 */
export function media({ milestones = [25, 50, 75] }: MediaOptions = {}): Plugin {
  return {
    name: 'media',
    setup(analy) {
      const watches = new WeakMap<HTMLMediaElement, Watch>();
      const playing = new Set<HTMLMediaElement>();

      const watchOf = (el: HTMLMediaElement) => {
        let watch = watches.get(el);
        if (!watch) watches.set(el, (watch = { watchedSeconds: 0, lastTime: el.currentTime, reached: new Set() }));
        return watch;
      };
      const report = (el: HTMLMediaElement, action: MediaProps['action'], extra: Pick<MediaProps, 'percent' | 'code'> = {}) =>
        analy.track('media', {
          action,
          kind: el.tagName === 'VIDEO' ? 'video' : 'audio',
          media: el.getAttribute(ATTRIBUTE) || el.getAttribute('id') || fileName(el.currentSrc) || el.tagName.toLowerCase(),
          src: el.currentSrc,
          position: round(el.currentTime),
          duration: Number.isFinite(el.duration) ? round(el.duration) : null,
          muted: el.muted,
          watchedSeconds: round(watchOf(el).watchedSeconds),
          ...extra,
        });
      const ignored = (el: HTMLMediaElement) =>
        el.hasAttribute(`${ATTRIBUTE}-ignore`) || (el.hasAttribute('autoplay') && el.hasAttribute('loop') && el.muted);

      const onMedia = (event: Event) => {
        const el = event.target;
        if (!(el instanceof HTMLMediaElement) || ignored(el)) return;
        const watch = watchOf(el);
        if (event.type === 'play') {
          watch.lastTime = el.currentTime;
          playing.add(el);
          report(el, 'play');
        } else if (event.type === 'timeupdate') {
          const step = el.currentTime - watch.lastTime;
          if (playing.has(el) && step > 0 && step < MAX_STEP_SECONDS) watch.watchedSeconds += step;
          watch.lastTime = el.currentTime;
          const percent = Number.isFinite(el.duration) && el.duration > 0 ? (el.currentTime / el.duration) * 100 : 0;
          for (const milestone of milestones) {
            if (percent < milestone || watch.reached.has(milestone)) continue;
            watch.reached.add(milestone);
            report(el, 'progress', { percent: milestone });
          }
        } else if (event.type === 'pause') {
          // Reaching the end fires pause and then ended; only ended is reported.
          if (el.ended || !playing.delete(el)) return;
          report(el, 'pause');
        } else if (event.type === 'ended') {
          playing.delete(el);
          report(el, 'complete', { percent: 100 });
        } else if (event.type === 'error') {
          report(el, 'error', { code: el.error?.code ?? null });
        }
      };
      const stopPlaying = () => {
        playing.forEach((el) => report(el, 'stop'));
        playing.clear();
      };

      // Media events do not bubble, but capture listeners on document see them all, even for
      // players added after start-up.
      EVENTS.forEach((type) => document.addEventListener(type, onMedia, true));
      const offLeave = analy.on('leave', stopPlaying);
      const offHide = analy.on('hide', ({ final }) => {
        if (final) stopPlaying();
      });
      return () => {
        EVENTS.forEach((type) => document.removeEventListener(type, onMedia, true));
        offLeave();
        offHide();
      };
    },
  };
}
