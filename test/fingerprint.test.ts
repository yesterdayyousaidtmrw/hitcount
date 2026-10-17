import { describe, expect, it, vi } from 'vitest';
import { fingerprint } from '../src/plugins/fingerprint';
import type { Fingerprint } from '../src/types';
import { track } from './helpers';

const HEX_128 = /^[0-9a-f]{32}$/;
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

interface FakeDevice {
  /** What each toDataURL call returns. */
  canvas?: () => string;
  /** Families the fake 2d context measures wider than the generic fallbacks, as if installed. */
  fonts?: string[];
  renderer?: string;
  /** False hides WEBGL_debug_renderer_info, as some browsers do. */
  debugInfo?: boolean;
}

// happy-dom has no canvas or WebGL: this gives every canvas a fake 2d and webgl context. It returns the
// getContext spy, so a test can tell whether anything was read from the device.
// Another device has its own storage, so it never shares a session (or a saved fingerprint).
function ownStorage() {
  localStorage.clear();
  sessionStorage.clear();
}

function fakeDevice({
  canvas = () => 'data:image/png;base64,stable',
  fonts = [],
  renderer = 'ANGLE (Apple, Apple M2, OpenGL 4.1)',
  debugInfo = true,
}: FakeDevice = {}) {
  ownStorage();
  const webgl = {
    VENDOR: 0x1f00,
    RENDERER: 0x1f01,
    getExtension(name: string) {
      if (name === 'WEBGL_debug_renderer_info') {
        return debugInfo ? { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 } : null;
      }
      return name === 'WEBGL_lose_context' ? { loseContext() {} } : null;
    },
    getParameter: (name: number) => (name === 0x9246 || name === 0x1f01 ? renderer : 'Google Inc.'),
  };
  const context2d = () => {
    const ctx = {
      font: '',
      fillStyle: '',
      textBaseline: '',
      globalCompositeOperation: '',
      fillRect() {},
      fillText() {},
      beginPath() {},
      arc() {},
      fill() {},
      measureText: () => ({ width: fonts.some((family) => ctx.font.includes(family)) ? 120 : 100 }),
    };
    return ctx;
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(canvas);
  return vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(((type: string) => (type === '2d' ? context2d() : type === 'webgl' ? webgl : null)) as never);
}

/** One page load: a fresh tracker and plugin, one event. */
function fingerprintOf(): Fingerprint | undefined {
  const { hitcount, sent } = track({ plugins: [fingerprint()] });
  hitcount.track('probe');
  hitcount.destroy();
  return sent[0].fingerprint;
}

describe('fingerprint plugin', () => {
  it('stamps one fingerprint on every event, computed once on the first', () => {
    const getContext = fakeDevice();
    const { hitcount, sent } = track({ plugins: [fingerprint()] });
    hitcount.track('a');
    const reads = getContext.mock.calls.length;
    hitcount.track('b');
    hitcount.track('c');

    expect(sent[0].fingerprint).toEqual({ id: expect.stringMatching(HEX_128), scrambled: false, reasons: [] });
    expect(sent.map((e) => e.fingerprint)).toEqual(sent.map(() => sent[0].fingerprint));
    expect(reads).toBeGreaterThan(0);
    expect(getContext).toHaveBeenCalledTimes(reads);
  });

  it('reads the device once per session: later pages of the session reuse it', () => {
    const getContext = fakeDevice();
    const first = fingerprintOf();
    const reads = getContext.mock.calls.length;
    expect(fingerprintOf()).toEqual(first);
    expect(getContext).toHaveBeenCalledTimes(reads);
  });

  it('gives the same device the same id on the next page load, even with its storage cleared', () => {
    fakeDevice();
    const first = fingerprintOf();
    localStorage.clear();
    expect(first?.id).toMatch(HEX_128);
    expect(fingerprintOf()?.id).toBe(first?.id);
  });

  it('tells devices apart by canvas, fonts and GPU', () => {
    const devices: FakeDevice[] = [
      {},
      { canvas: () => 'data:image/png;base64,other' },
      { fonts: ['Calibri'] },
      { renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, D3D11)' },
    ];
    const ids = devices.map((device) => {
      fakeDevice(device);
      return fingerprintOf()?.id;
    });
    expect(ids.every((id) => id && HEX_128.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(devices.length);
  });

  it('leaves a noisy canvas out of the id and calls the fingerprint scrambled', () => {
    let draws = 0;
    fakeDevice({ canvas: () => `data:image/png;base64,noise${draws++}` });
    const first = fingerprintOf();
    const next = fingerprintOf();

    expect(first).toMatchObject({ scrambled: true, reasons: ['canvas-noise'] });
    // Each load read different noise: the ids only match because the canvas is not in them.
    expect(next?.id).toBe(first?.id);
  });

  it('falls back to the WebGL RENDERER when the debug extension is hidden', () => {
    fakeDevice({ debugInfo: false });
    const masked = fingerprintOf();
    expect(masked?.reasons).toEqual([]);

    fakeDevice({ debugInfo: false, renderer: 'Mesa Intel(R) UHD Graphics 620' });
    expect(fingerprintOf()?.id).not.toBe(masked?.id);
  });

  it('identifies the device without canvas or WebGL and does not call that scrambled', () => {
    const onError = vi.fn();
    const { hitcount, sent } = track({ plugins: [fingerprint()], onError });
    hitcount.track('a');

    expect(sent[0].fingerprint).toEqual({
      id: expect.stringMatching(HEX_128),
      scrambled: false,
      reasons: ['canvas-unavailable', 'webgl-unavailable'],
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('never throws into the page or drops the event when canvas and WebGL are blocked', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const onError = vi.fn();
    const { hitcount, sent } = track({ plugins: [fingerprint()], onError });

    expect(() => hitcount.track('a')).not.toThrow();
    expect(sent[0].fingerprint?.reasons).toEqual(['canvas-unavailable', 'webgl-unavailable']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reads nothing from the device until consent is granted', () => {
    const getContext = fakeDevice();
    const { hitcount, sent } = track({ consent: 'pending', plugins: [fingerprint()] });
    hitcount.track('early');
    expect(getContext).not.toHaveBeenCalled();

    hitcount.consent('granted');
    expect(getContext).toHaveBeenCalled();
    expect(sent[0].fingerprint?.id).toMatch(HEX_128);
  });

  it('calls Brave scrambled, because it varies its readings per site and session', () => {
    fakeDevice();
    Object.defineProperty(navigator, 'brave', { value: {}, configurable: true });
    try {
      expect(fingerprintOf()).toMatchObject({ scrambled: true, reasons: ['brave'] });
    } finally {
      Reflect.deleteProperty(navigator, 'brave');
    }
  });

  it("calls Firefox's resistFingerprinting scrambled: UTC with a screen the size of the window", () => {
    fakeDevice();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'UTC',
    } as Intl.ResolvedDateTimeFormatOptions);
    const spoof = (target: object, key: string, value: unknown) =>
      Object.defineProperty(target, key, { value, configurable: true });
    spoof(navigator, 'userAgent', FIREFOX);
    spoof(screen, 'width', innerWidth);
    spoof(screen, 'height', innerHeight);
    try {
      expect(fingerprintOf()).toMatchObject({ scrambled: true, reasons: ['resist-fingerprinting'] });

      // Headless Chrome on a UTC server looks the same apart from the user agent.
      ownStorage();
      spoof(navigator, 'userAgent', CHROME);
      expect(fingerprintOf()).toMatchObject({ scrambled: false, reasons: [] });

      // A real screen is taller than a window with toolbars.
      ownStorage();
      spoof(navigator, 'userAgent', FIREFOX);
      spoof(screen, 'height', innerHeight + 80);
      expect(fingerprintOf()).toMatchObject({ scrambled: false, reasons: [] });
    } finally {
      Reflect.deleteProperty(navigator, 'userAgent');
      Reflect.deleteProperty(screen, 'width');
      Reflect.deleteProperty(screen, 'height');
    }
  });
});
