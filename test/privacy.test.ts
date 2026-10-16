import { describe, expect, it } from 'vitest';
import { hasPrivacySignal } from '../src/core/privacy';

describe('hasPrivacySignal', () => {
  it('reads Do Not Track', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    try {
      expect(hasPrivacySignal()).toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, 'doNotTrack');
    }
    expect(hasPrivacySignal()).toBe(false);
  });
});
