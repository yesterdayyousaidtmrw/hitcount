import { describe, expect, it, vi } from 'vitest';
import { rageclicks } from '../src/plugins/rageclicks';
import { track } from './helpers';

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
