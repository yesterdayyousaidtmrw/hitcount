import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { traffic } from '../src/plugins/traffic';
import { track, trusted } from './helpers';

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

function moveMouse(times: number, isTrusted = true) {
  for (let i = 0; i < times; i++) {
    const move = new PointerEvent('pointermove', { pointerType: 'mouse' });
    dispatchEvent(isTrusted ? trusted(move) : move);
  }
}

const finePointer = () => vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);

// happy-dom reports navigator.webdriver = true (it is automation, after all); act like a normal browser.
beforeEach(() => {
  Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'userAgent');
  Reflect.deleteProperty(navigator, 'webdriver');
});

describe('traffic', () => {
  it('starts unknown and becomes human after real mouse movement', () => {
    const { analy, sent } = track({ plugins: [traffic()] });
    analy.track('a');
    moveMouse(20);
    analy.track('b');
    expect(sent.map((e) => e.traffic)).toEqual([
      { kind: 'unknown', signals: [] },
      { kind: 'human', signals: [] },
    ]);
  });

  it('does not count synthetic mouse movement as human', () => {
    const { analy, sent } = track({ plugins: [traffic()] });
    moveMouse(50, false);
    analy.track('a');
    expect(sent[0].traffic?.kind).toBe('unknown');
  });

  it.each([
    ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', 'ai-agent'],
    ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ai-agent'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'crawler'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36', 'automated'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'unknown'],
  ])('classifies %s as %s', (ua, kind) => {
    setUserAgent(ua);
    const { analy, sent } = track({ plugins: [traffic()] });
    analy.track('a');
    expect(sent[0].traffic?.kind).toBe(kind);
  });

  it('flags navigator.webdriver as automated', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const { analy, sent } = track({ plugins: [traffic()] });
    analy.track('a');
    expect(sent[0].traffic).toEqual({ kind: 'automated', signals: ['webdriver'] });
  });

  it('flags a mouse click that arrived without the mouse ever moving', () => {
    finePointer();
    const { analy, sent } = track({ plugins: [traffic()] });
    dispatchEvent(trusted(new PointerEvent('pointerdown', { pointerType: 'mouse' })));
    document.body.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, detail: 1 })));
    analy.track('a');
    expect(sent[0].traffic).toEqual({ kind: 'automated', signals: ['click-without-mouse-movement'] });
  });

  it('does not flag keyboard activation or touch taps', () => {
    finePointer();
    const { analy, sent } = track({ plugins: [traffic()] });
    document.body.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, detail: 0 })));
    dispatchEvent(trusted(new PointerEvent('pointerdown', { pointerType: 'touch' })));
    document.body.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, detail: 1 })));
    analy.track('a');
    expect(sent[0].traffic?.signals).toEqual([]);
  });

  it('flags clicks that keep landing dead-centre on their target (agent-style)', () => {
    document.body.innerHTML = '<button>x</button>';
    const button = document.querySelector('button')!;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 40 } as DOMRect);
    const clickAt = (x: number, y: number) =>
      button.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, detail: 1, clientX: x, clientY: y })));
    const { analy, sent } = track({ plugins: [traffic()] });
    moveMouse(30);

    clickAt(31, 12);
    clickAt(72, 27);
    clickAt(50, 20);
    clickAt(50, 21);
    analy.track('human-so-far');
    clickAt(51, 20);
    analy.track('agent');

    expect(sent.map((e) => e.traffic?.kind)).toEqual(['human', 'automated']);
    expect(sent[1].traffic?.signals).toEqual(['centered-clicks']);
  });

  it('drops the kinds listed in drop', () => {
    setUserAgent('Mozilla/5.0 (compatible; bingbot/2.0)');
    const { analy, sent } = track({ plugins: [traffic({ drop: ['crawler'] })] });
    analy.track('a');
    expect(sent).toHaveLength(0);
  });
});
