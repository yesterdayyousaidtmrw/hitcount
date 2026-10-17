import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deadclicks } from '../src/plugins/deadclicks';
import type { Hitcount } from '../src/types';
import { setVisibility, track } from './helpers';

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const click = (selector: string, init: MouseEventInit = {}) =>
  $(selector).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init }));
const deadClicks = (sent: Array<{ name: string; props: object }>) => sent.filter((e) => e.name === 'dead_click').map((e) => e.props);

const PAGE = `
  <button id="buy" class="btn primary wide">Buy</button>
  <div id="next" role="button" aria-disabled="true"><span>Next</span></div>
  <button id="save" disabled><span>Save</span></button>
  <a id="reload" href="/"><span>Reload</span></a>
  <input id="agree" type="checkbox">
  <input id="field">
  <p id="note">note</p>
  <div id="plain">plain</div>`;

describe('deadclicks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = PAGE;
  });

  it('reports a click on a button when nothing happens within a second', async () => {
    const { sent } = track({ plugins: [deadclicks()] });
    click('#buy');
    await vi.advanceTimersByTimeAsync(999);
    expect(deadClicks(sent)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'dead_click', props: { element: 'button#buy.btn.primary', disabled: false } });
  });

  it('reports the actionable element rather than the child clicked, and whether it was disabled', async () => {
    const { sent } = track({ plugins: [deadclicks({ waitMs: 300 })] });
    click('#next span');
    click('#save span');
    await vi.advanceTimersByTimeAsync(300);
    expect(deadClicks(sent)).toEqual([
      { element: 'div#next', disabled: true },
      { element: 'button#save', disabled: true },
    ]);
  });

  it.each<[string, (hitcount: Hitcount) => unknown]>([
    ['an element is added', () => document.body.append(document.createElement('dialog'))],
    ['an attribute changes', () => $('#buy').setAttribute('aria-expanded', 'true')],
    ['text changes', () => { $('#note').firstChild!.nodeValue = 'saved'; }],
    ['the URL changes', () => history.pushState(null, '', '/cart')],
    ['focus moves to another element', () => $('#field').focus()],
    ['the page scrolls', () => dispatchEvent(new Event('scroll'))],
    ['the page is hidden', () => setVisibility('hidden')],
    ['a new page view starts', (hitcount) => { hitcount.page(); hitcount.page(); }],
  ])('stays quiet when %s before the wait is over', async (_, react) => {
    const { hitcount, sent } = track({ plugins: [deadclicks()] });
    click('#buy');
    await vi.advanceTimersByTimeAsync(500);
    react(hitcount);
    await vi.advanceTimersByTimeAsync(2000);
    expect(deadClicks(sent)).toEqual([]);
  });

  it('stays quiet when a checkbox toggles, though only a property changed', async () => {
    const { sent } = track({ plugins: [deadclicks()] });
    $<HTMLInputElement>('#agree').click();
    await vi.advanceTimersByTimeAsync(2000);
    expect($<HTMLInputElement>('#agree').checked).toBe(true);
    expect(deadClicks(sent)).toEqual([]);
  });

  it('leaves a link the browser follows alone, but reports one whose click was swallowed', async () => {
    const { sent } = track({ plugins: [deadclicks()] });
    const stay = (event: Event) => event.preventDefault();
    // A link to the page it is on: a real browser reloads, which can outlast the wait. happy-dom only
    // sets the same URL again, so the URL check cannot be what keeps this quiet.
    click('#reload span');
    await vi.advanceTimersByTimeAsync(1000);
    expect(location.pathname).toBe('/');
    expect(deadClicks(sent)).toEqual([]);
    $('#reload').addEventListener('click', stay);
    click('#reload span');
    await vi.advanceTimersByTimeAsync(1000);
    expect(deadClicks(sent)).toEqual([{ element: 'a#reload', disabled: false }]);
  });

  it('ignores elements that do not look actionable, and modified or non-primary clicks', async () => {
    const { sent } = track({ plugins: [deadclicks()] });
    click('#plain');
    click('#note');
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) click('#buy', init);
    await vi.advanceTimersByTimeAsync(2000);
    expect(deadClicks(sent)).toEqual([]);
  });

  it('runs one check per element at a time', async () => {
    const { sent } = track({ plugins: [deadclicks()] });
    click('#buy');
    await vi.advanceTimersByTimeAsync(400);
    click('#buy');
    click('#buy');
    await vi.advanceTimersByTimeAsync(600);
    expect(deadClicks(sent)).toHaveLength(1);
    click('#buy');
    await vi.advanceTimersByTimeAsync(1000);
    expect(deadClicks(sent)).toHaveLength(2);
  });

  it('cancels pending checks when the tracker is destroyed', () => {
    const { hitcount } = track({ plugins: [deadclicks()] });
    click('#buy');
    expect(vi.getTimerCount()).toBe(1);
    hitcount.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
