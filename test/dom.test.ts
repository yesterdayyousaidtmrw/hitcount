import { describe, expect, it } from 'vitest';
import { closestInPath, targetElement } from '../src/core/dom';

// happy-dom's own dispatch needs composedPath(), so an event from a browser without it is a plain object.
const withoutComposedPath = (target: EventTarget) => ({ target }) as unknown as Event;

describe('dom', () => {
  it('falls back to the event target where composedPath() is missing', () => {
    document.body.innerHTML = '<button data-hitcount="signup"><span>Go</span></button>';
    const event = withoutComposedPath(document.querySelector('span')!);
    expect(targetElement(event)?.tagName).toBe('SPAN');
    expect(closestInPath(event, '[data-hitcount]')?.tagName).toBe('BUTTON');
    expect(closestInPath(event, 'a[href]')).toBeNull();
  });
});
