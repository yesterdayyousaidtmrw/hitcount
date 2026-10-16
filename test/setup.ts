import { afterEach, beforeEach, vi } from 'vitest';
import { resetDom } from './helpers';

// Server-side tests (// @vitest-environment node) have no DOM to reset.
const hasDom = typeof document !== 'undefined';

beforeEach(() => {
  if (hasDom) Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  if (hasDom) resetDom();
});
