import type { Plugin } from '../types';
import { describe, targetElement } from '../core/dom';

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Every click as `heatmap_click`: page coordinates plus the position inside the clicked element
 * (0–1), which stays meaningful across screen sizes. Opt-in: it is one event per click.
 */
export function heatmap(): Plugin {
  return {
    name: 'heatmap',
    setup(hitcount) {
      const onClick = (event: MouseEvent) => {
        const el = targetElement(event);
        if (!el) return;
        const box = el.getBoundingClientRect();
        const doc = document.documentElement;
        hitcount.track('heatmap_click', {
          element: describe(el),
          x: Math.round(event.pageX),
          y: Math.round(event.pageY),
          pageWidth: doc.scrollWidth,
          pageHeight: doc.scrollHeight,
          elementX: box.width ? round((event.clientX - box.left) / box.width) : null,
          elementY: box.height ? round((event.clientY - box.top) / box.height) : null,
        });
      };

      document.addEventListener('click', onClick, true);
      return () => document.removeEventListener('click', onClick, true);
    },
  };
}
