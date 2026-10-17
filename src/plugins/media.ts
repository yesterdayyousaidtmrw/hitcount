import type { Plugin } from '../types';
import { ATTRIBUTE } from '../core/dom';
import { trackPlayback } from './playback';

export interface MediaOptions {
  /** Progress milestones, in percent. Default [25, 50, 75]. */
  milestones?: number[];
}

const EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'error'];

const fileName = (src: string) => src.split(/[?#]/)[0].split('/').pop() ?? '';

/**
 * <video> and <audio> as `media` events: play, pause, progress milestones, complete, error, and
 * stop when the page is left mid-play, each with position and real watched time. Name a player
 * with data-analy; skip one with data-analy-ignore. Muted looping autoplay (background video) is
 * skipped automatically. Embedded YouTube/Vimeo players are iframes: embeds() reports those.
 */
export function media({ milestones = [25, 50, 75] }: MediaOptions = {}): Plugin {
  return {
    name: 'media',
    setup(analy) {
      const playback = trackPlayback<HTMLMediaElement>(
        analy,
        (el) => ({
          kind: el.tagName === 'VIDEO' ? 'video' : 'audio',
          media: el.getAttribute(ATTRIBUTE) || el.getAttribute('id') || fileName(el.currentSrc) || el.tagName.toLowerCase(),
          src: el.currentSrc,
          position: el.currentTime,
          duration: el.duration,
          muted: el.muted,
        }),
        milestones,
      );
      const ignored = (el: HTMLMediaElement) =>
        el.hasAttribute(`${ATTRIBUTE}-ignore`) || (el.hasAttribute('autoplay') && el.hasAttribute('loop') && el.muted);

      const onMedia = (event: Event) => {
        const el = event.target;
        if (!(el instanceof HTMLMediaElement) || ignored(el)) return;
        if (event.type === 'play') playback.play(el);
        else if (event.type === 'timeupdate') playback.timeupdate(el);
        // Reaching the end fires pause and then ended; only ended is reported.
        else if (event.type === 'pause' && !el.ended) playback.pause(el);
        else if (event.type === 'ended') playback.complete(el);
        else if (event.type === 'error') playback.error(el, el.error?.code ?? null);
      };

      // Media events do not bubble, but capture listeners on document see them all, even for
      // players added after start-up.
      EVENTS.forEach((type) => document.addEventListener(type, onMedia, true));
      return () => {
        EVENTS.forEach((type) => document.removeEventListener(type, onMedia, true));
        playback.destroy();
      };
    },
  };
}
