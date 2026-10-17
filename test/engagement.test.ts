import { describe, expect, it, vi } from 'vitest';
import { engagement } from '../src/plugins/engagement';
import { setVisibility, track } from './helpers';

describe('engagement', () => {
  it('reports active time and scroll depth when the page is hidden', () => {
    vi.useFakeTimers();
    const { sent } = track({ plugins: [engagement()] });
    vi.advanceTimersByTime(5000);
    dispatchEvent(new Event('pointermove'));
    vi.advanceTimersByTime(2000);
    setVisibility('hidden');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'engagement', props: { activeMs: 7000 } });
    expect(sent[0].props.scrollDepth).toEqual(expect.any(Number));
  });

  it('caps each input-free stretch at idleMs', () => {
    vi.useFakeTimers();
    const { sent } = track({ plugins: [engagement({ idleMs: 10_000 })] });
    vi.advanceTimersByTime(60_000);
    setVisibility('hidden');
    expect(sent[0].props.activeMs).toBe(10_000);
  });

  it('does not count hidden time and sends nothing for an empty period', () => {
    vi.useFakeTimers();
    const { sent } = track({ plugins: [engagement()] });
    vi.advanceTimersByTime(1000);
    setVisibility('hidden');
    vi.advanceTimersByTime(20_000);
    setVisibility('visible');
    vi.advanceTimersByTime(2000);
    setVisibility('hidden');
    dispatchEvent(new Event('pagehide'));

    expect(sent.map((e) => e.props.activeMs)).toEqual([1000, 2000]);
  });

  it('closes out the old page view before an SPA navigation starts a new one', () => {
    vi.useFakeTimers();
    const { hitcount, sent } = track({ plugins: [engagement()] });
    hitcount.page();
    vi.advanceTimersByTime(3000);
    history.pushState(null, '', '/next');
    hitcount.page();

    expect(sent.map((e) => e.name)).toEqual(['pageview', 'engagement', 'pageview']);
    expect(sent[1].page.viewId).toBe(sent[0].page.viewId);
    expect(sent[1].props.activeMs).toBe(3000);
  });
});
