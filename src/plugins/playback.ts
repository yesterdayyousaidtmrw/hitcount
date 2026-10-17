import type { MediaProps } from '../events';
import type { Analy } from '../types';

/** A player as it is right now. */
export interface PlayerState {
  kind: MediaProps['kind'];
  provider?: MediaProps['provider'];
  media: string;
  src: string;
  /** Seconds into the media. */
  position: number;
  /** Seconds; NaN or Infinity while unknown or live. */
  duration: number;
  muted: boolean;
}

/** One call per thing a player did; each may send a `media` event. */
export interface Playback<P> {
  play(player: P): void;
  timeupdate(player: P): void;
  pause(player: P): void;
  complete(player: P): void;
  error(player: P, code: number | null): void;
  isPlaying(player: P): boolean;
  /** Stops listening for the page being left. */
  destroy(): void;
}

interface Watch {
  watchedSeconds: number;
  lastTime: number;
  reached: Set<number>;
}

// Time updates arrive about every 250 ms (<video> timeupdate, and YouTube and Vimeo embeds alike);
// a bigger jump between two of them is a seek, not playback.
const MAX_STEP_SECONDS = 1.5;

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The bookkeeping behind every `media` event, shared by media() and embeds() so a <video> and a
 * YouTube iframe report alike: watched time without seeks, each milestone once, and a stop for
 * whatever is still playing when the page is left.
 */
export function trackPlayback<P extends object>(analy: Analy, read: (player: P) => PlayerState, milestones: number[]): Playback<P> {
  const watches = new WeakMap<P, Watch>();
  const playing = new Set<P>();

  const watchOf = (player: P) => {
    let watch = watches.get(player);
    if (!watch) watches.set(player, (watch = { watchedSeconds: 0, lastTime: read(player).position, reached: new Set() }));
    return watch;
  };
  const report = (player: P, action: MediaProps['action'], extra: Pick<MediaProps, 'percent' | 'code'> = {}) => {
    const { kind, provider, media, src, position, duration, muted } = read(player);
    analy.track('media', {
      action,
      kind,
      ...(provider && { provider }),
      media,
      src,
      position: round(position),
      duration: Number.isFinite(duration) ? round(duration) : null,
      muted,
      watchedSeconds: round(watchOf(player).watchedSeconds),
      ...extra,
    });
  };
  const stop = () => {
    playing.forEach((player) => report(player, 'stop'));
    playing.clear();
  };
  const offLeave = analy.on('leave', stop);
  const offHide = analy.on('hide', ({ final }) => {
    if (final) stop();
  });

  return {
    play(player) {
      watchOf(player).lastTime = read(player).position;
      playing.add(player);
      report(player, 'play');
    },
    timeupdate(player) {
      const watch = watchOf(player);
      const { position, duration } = read(player);
      const step = position - watch.lastTime;
      if (playing.has(player) && step > 0 && step < MAX_STEP_SECONDS) watch.watchedSeconds += step;
      watch.lastTime = position;
      const percent = Number.isFinite(duration) && duration > 0 ? (position / duration) * 100 : 0;
      for (const milestone of milestones) {
        if (percent < milestone || watch.reached.has(milestone)) continue;
        watch.reached.add(milestone);
        report(player, 'progress', { percent: milestone });
      }
    },
    pause(player) {
      if (playing.delete(player)) report(player, 'pause');
    },
    complete(player) {
      playing.delete(player);
      report(player, 'complete', { percent: 100 });
    },
    error: (player, code) => report(player, 'error', { code }),
    isPlaying: (player) => playing.has(player),
    destroy() {
      offLeave();
      offHide();
    },
  };
}
