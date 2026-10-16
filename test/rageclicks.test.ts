import { describe, expect, it, vi } from 'vitest';
import { rageclicks } from '../src/plugins/rageclicks';
import { dispatchInShadow, openShadowRoot, track } from './helpers';

function clickAt(x: number, y: number) {
  document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, detail: 1 }));
}

describe('rageclicks', () => {
  it('fires once for three quick clicks on one spot', () => {
    document.body.innerHTML = '<button id="buy" class="btn primary wide">Buy</button>';
    const { sent } = track({ plugins: [rageclicks()] });
    clickAt(10, 10);
    clickAt(12, 11);
    clickAt(11, 9);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'rage_click', props: { element: 'button#buy.btn.primary', clicks: 3 } });
  });

  it('describes the clicked element inside an open shadow root, not its host', () => {
    const button = openShadowRoot('<button id="buy" class="btn">Buy</button>').querySelector('button')!;
    const { sent } = track({ plugins: [rageclicks()] });
    for (let i = 0; i < 3; i++) {
      dispatchInShadow(button, new MouseEvent('click', { bubbles: true, composed: true, clientX: 10, clientY: 10, detail: 1 }));
    }
    expect(sent.map((e) => e.props.element)).toEqual(['button#buy.btn']);
  });

  it('ignores slow or scattered clicks', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button>x</button>';
    const { sent } = track({ plugins: [rageclicks()] });
    clickAt(10, 10);
    vi.advanceTimersByTime(600);
    clickAt(10, 10);
    vi.advanceTimersByTime(600);
    clickAt(10, 10);
    clickAt(100, 100);
    clickAt(200, 200);
    expect(sent).toHaveLength(0);
  });

  it('ignores a triple-click that selected text', () => {
    document.body.innerHTML = '<button>x</button>';
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'selected words' } as Selection);
    const { sent } = track({ plugins: [rageclicks()] });
    clickAt(10, 10);
    clickAt(10, 10);
    clickAt(10, 10);
    expect(sent).toHaveLength(0);
  });
});
