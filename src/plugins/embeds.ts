import type { MediaProps } from '../events';
import type { Plugin } from '../types';
import { ATTRIBUTE } from '../core/dom';
import { trackPlayback } from './playback';

export interface EmbedsOptions {
  /** Progress milestones, in percent. Default [25, 50, 75]. */
  milestones?: number[];
  /**
   * Add enablejsapi=1 (and origin, when missing) to YouTube iframes that lack it, as soon as they
   * appear: without it YouTube tells the page nothing. Changing the src reloads the iframe, so a
   * video that had already started plays from the beginning again; putting enablejsapi=1 in the
   * embed code avoids the reload. Default false.
   */
  enableApi?: boolean;
}

type Fields = Record<string, unknown>;

interface Embed {
  iframe: HTMLIFrameElement;
  provider: NonNullable<MediaProps['provider']>;
  /** The src this state belongs to: a new src is a new video. */
  src: string;
  /** The only origin whose messages are believed, and where commands go. */
  origin: string;
  videoId: string;
  position: number;
  duration: number;
  muted: boolean;
  /** YouTube's last playerState, so a state delivered again is not reported again. */
  state?: number;
}

// youtube.com and youtube-nocookie.com embeds redirect to www., so www. is where messages come from
// and where commands must go (seen live: a youtube.com/embed iframe answers from www.youtube.com).
const EMBED_SRC = /^https?:\/\/(?:www\.)?(youtube(?:-nocookie)?\.com)\/embed\/([^/?#]+)|^https?:\/\/player\.vimeo\.com\/video\/(\d+)/;
const VIMEO_EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'volumechange'];

const isSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const fields = (value: unknown): Fields => (value && typeof value === 'object' ? (value as Fields) : {});
// YouTube posts JSON strings; Vimeo posts objects, except its first {"event":"ready"}, a string.
const readMessage = (data: unknown): Fields => {
  if (typeof data !== 'string') return fields(data);
  try {
    return fields(JSON.parse(data));
  } catch {
    // Not JSON, so another widget's message, not a player's.
    return {};
  }
};

/**
 * YouTube and Vimeo iframe players as `media` events, the same play, pause, progress, complete and
 * stop that media() sends for <video>, with `provider` set. Players added later are seen too. Name
 * one with data-hitcount (else its id, else the video id); skip one with data-hitcount-ignore. YouTube
 * only reports when the iframe's src has enablejsapi=1: add it to the embed code, or set enableApi.
 * On a page that loads YouTube's own iframe API, a YouTube frame that had finished loading before
 * hitcount started is left to that API: it is reported once the page's own player drives it.
 */
export function embeds({ milestones = [25, 50, 75], enableApi = false }: EmbedsOptions = {}): Plugin {
  return {
    name: 'embeds',
    setup(hitcount) {
      const known = new WeakMap<HTMLIFrameElement, Embed>();
      const playback = trackPlayback<Embed>(
        hitcount,
        (embed) => ({
          kind: 'video',
          provider: embed.provider,
          media: embed.iframe.getAttribute(ATTRIBUTE) || embed.iframe.getAttribute('id') || embed.videoId,
          src: embed.src,
          position: embed.position,
          duration: embed.duration,
          muted: embed.muted,
        }),
        milestones,
      );
      const iframes = () => Array.from(document.getElementsByTagName('iframe'));

      const embedOf = (iframe: HTMLIFrameElement): Embed | undefined => {
        if (iframe.hasAttribute(`${ATTRIBUTE}-ignore`)) return undefined;
        const embed = known.get(iframe);
        if (embed?.src === iframe.src) return embed;
        const match = EMBED_SRC.exec(iframe.src);
        if (!match) return undefined;
        const found: Embed = {
          iframe,
          provider: match[1] ? 'youtube' : 'vimeo',
          src: iframe.src,
          origin: match[1] ? `https://www.${match[1]}` : 'https://player.vimeo.com',
          videoId: match[2] ?? match[3],
          position: 0,
          duration: NaN,
          muted: false,
        };
        known.set(iframe, found);
        return found;
      };

      const send = (embed: Embed, message: unknown) => {
        try {
          embed.iframe.contentWindow?.postMessage(message, embed.origin);
        } catch {
          // The frame is not on the provider's origin yet. Browsers drop such a message, some DOM
          // implementations throw; either way the frame's load event subscribes again.
        }
      };
      // Vimeo takes one addEventListener per event (sending them twice does not double the events,
      // seen live) and answers getMuted with {method:"getMuted",value}. YouTube answers
      // {"event":"listening"} with its deliveries, but to one client only: whoever asked last. Seen
      // live, asking after a page's own YT.Player had asked left that player with no events. So
      // YouTube is asked as the frame loads (this capture listener runs before the page's own load
      // handlers, and a client that asks later takes over while hitcount still hears the broadcast),
      // and a frame that loaded before start-up only when the page has not loaded YouTube's API.
      const asked = new WeakSet<HTMLIFrameElement>();
      const subscribe = (iframe: HTMLIFrameElement, loading: boolean) => {
        const embed = embedOf(iframe);
        if (!embed) return;
        asked.add(iframe);
        if (embed.provider === 'vimeo') {
          VIMEO_EVENTS.forEach((value) => send(embed, { method: 'addEventListener', value }));
          send(embed, { method: 'getMuted' });
        } else if (loading || !('YT' in window)) {
          send(embed, JSON.stringify({ event: 'listening', id: 'hitcount', channel: 'widget' }));
        }
      };
      const catchUp = () =>
        iframes().forEach((iframe) => {
          if (!asked.has(iframe)) subscribe(iframe, false);
        });

      // YouTube, as observed live on 2026-10-16 (the protocol its iframe_api speaks; undocumented):
      // initialDelivery and onReady, then {"event":"infoDelivery","info":{…}} whenever something
      // changes: {playerState, currentTime, duration, …} on a state change, {currentTime, …} about
      // every 260 ms while playing, {muted, volume} on a volume change. playerState: -1 unstarted,
      // 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. Ending goes straight from 1 to 0.
      const onYouTube = (embed: Embed, { event, info }: Fields) => {
        if (event !== 'infoDelivery' && event !== 'initialDelivery') return;
        const { playerState, currentTime, duration, muted } = fields(info);
        if (typeof muted === 'boolean') embed.muted = muted;
        if (isSeconds(duration) && duration > 0) embed.duration = duration;
        if (isSeconds(currentTime)) {
          embed.position = currentTime;
          playback.timeupdate(embed);
        }
        if (typeof playerState !== 'number' || playerState === embed.state) return;
        embed.state = playerState;
        if (playerState === 1 && !playback.isPlaying(embed)) playback.play(embed);
        else if (playerState === 2) playback.pause(embed);
        else if (playerState === 0) playback.complete(embed);
      };

      // Vimeo, its documented player.js protocol, as observed live on 2026-10-16: {event, data:
      // {seconds, percent (0–1), duration}} for play, pause, ended, and timeupdate about every 265 ms;
      // volumechange carries {volume, muted}. Reaching the end posts pause (percent 1), then ended.
      const onVimeo = (embed: Embed, { event, data, method, value }: Fields) => {
        const { seconds, duration, percent, volume, muted } = fields(data);
        if (isSeconds(seconds)) embed.position = seconds;
        if (isSeconds(duration) && duration > 0) embed.duration = duration;
        if (event === 'ready') subscribe(embed.iframe, true);
        else if (method === 'getMuted' && typeof value === 'boolean') embed.muted = value;
        // At volume 0 Vimeo's volumechange still says muted: false, while its getMuted says true.
        else if (event === 'volumechange') embed.muted = muted === true || volume === 0;
        else if (event === 'timeupdate') playback.timeupdate(embed);
        else if (event === 'play' && !playback.isPlaying(embed)) playback.play(embed);
        else if (event === 'pause' && percent !== 1) playback.pause(embed);
        else if (event === 'ended') playback.complete(embed);
      };

      const onMessage = (event: MessageEvent) => {
        if (!event.source) return;
        const iframe = iframes().find((frame) => frame.contentWindow === event.source);
        const embed = iframe && embedOf(iframe);
        if (!embed || event.origin !== embed.origin) return;
        if (embed.provider === 'youtube') onYouTube(embed, readMessage(event.data));
        else onVimeo(embed, readMessage(event.data));
      };
      // load does not bubble, but a capture listener on document sees every iframe's.
      const onFrameLoad = (event: Event) => {
        if (event.target instanceof HTMLIFrameElement) subscribe(event.target, true);
      };

      const enableYouTubeApi = (iframe: HTMLIFrameElement) => {
        const embed = embedOf(iframe);
        if (embed?.provider !== 'youtube') return;
        const url = new URL(embed.src);
        if (url.searchParams.get('enablejsapi') === '1') return;
        url.searchParams.set('enablejsapi', '1');
        if (!url.searchParams.has('origin')) url.searchParams.set('origin', location.origin);
        iframe.src = url.href;
      };
      const observer = enableApi ? new MutationObserver(() => iframes().forEach(enableYouTubeApi)) : undefined;
      observer?.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
      if (enableApi) iframes().forEach(enableYouTubeApi);

      addEventListener('message', onMessage);
      document.addEventListener('load', onFrameLoad, true);
      // A frame that loaded before start-up fires no load event for us. Once the page has loaded,
      // every frame in its HTML has too, so they are caught up then rather than mid-load.
      if (document.readyState === 'complete') catchUp();
      else addEventListener('load', catchUp);
      return () => {
        observer?.disconnect();
        removeEventListener('message', onMessage);
        document.removeEventListener('load', onFrameLoad, true);
        removeEventListener('load', catchUp);
        playback.destroy();
      };
    },
  };
}
