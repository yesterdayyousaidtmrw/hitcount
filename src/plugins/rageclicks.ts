import type { Plugin } from '../types';
import { describe, targetElement } from '../core/dom';

export interface RageClickOptions {
  clicks?: number;
  withinMs?: number;
  radiusPx?: number;
}

/** Repeated clicks on one spot: the visitor expected something to happen and it didn't. */
export function rageclicks({ clicks = 3, withinMs = 1000, radiusPx = 30 }: RageClickOptions = {}): Plugin {
  return {
    name: 'rageclicks',
    setup(analy) {
      let burst: Array<{ x: number; y: number; t: number }> = [];

      const onClick = (event: MouseEvent) => {
        const now = Date.now();
        const { clientX: x, clientY: y } = event;
        burst = burst.filter((c) => now - c.t < withinMs && Math.hypot(c.x - x, c.y - y) < radiusPx);
        burst.push({ x, y, t: now });
        if (burst.length < clicks) return;
        const count = burst.length;
        burst = [];
        // A triple-click that selected text is a selection, not frustration.
        if (getSelection()?.toString()) return;
        const el = targetElement(event);
        analy.track('rage_click', { element: el ? describe(el) : null, clicks: count });
      };

      document.addEventListener('click', onClick, true);
      return () => document.removeEventListener('click', onClick, true);
    },
  };
}
