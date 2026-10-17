import type { Plugin } from '../types';

export interface EngagementOptions {
  /** Input-free time after which the visitor stops counting as active. Default 30s. */
  idleMs?: number;
}

const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'];
const LISTEN = { capture: true, passive: true };

/**
 * Sends one `engagement` event each time a page view is hidden or left: active time since the
 * last report (visible + recent input) and max scroll depth. Sum activeMs per viewId for the total.
 */
export function engagement({ idleMs = 30_000 }: EngagementOptions = {}): Plugin {
  return {
    name: 'engagement',
    setup(hitcount) {
      let activeMs = 0;
      let lastInput = Date.now();
      let visible = document.visibilityState === 'visible';
      let maxScroll = 0;

      const accrue = () => {
        const now = Date.now();
        if (visible) activeMs += Math.min(now - lastInput, idleMs);
        lastInput = now;
      };
      const measureScroll = () => {
        const height = Math.max(document.documentElement.scrollHeight, 1);
        maxScroll = Math.max(maxScroll, Math.min(100, Math.round(((scrollY + innerHeight) / height) * 100)));
      };
      const report = () => {
        accrue();
        if (activeMs > 0) hitcount.track('engagement', { activeMs: Math.round(activeMs), scrollDepth: maxScroll });
        activeMs = 0;
      };
      const onInput = (event: Event) => {
        accrue();
        if (event.type === 'scroll') measureScroll();
      };
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        visible = true;
        lastInput = Date.now();
      };

      INPUTS.forEach((type) => addEventListener(type, onInput, LISTEN));
      document.addEventListener('visibilitychange', onVisible);
      const offHide = hitcount.on('hide', () => {
        report();
        visible = false;
      });
      const offLeave = hitcount.on('leave', () => {
        report();
        maxScroll = 0;
        measureScroll();
      });
      measureScroll();

      return () => {
        INPUTS.forEach((type) => removeEventListener(type, onInput, LISTEN));
        document.removeEventListener('visibilitychange', onVisible);
        offHide();
        offLeave();
      };
    },
  };
}
