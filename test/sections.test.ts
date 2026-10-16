import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sections } from '../src/plugins/sections';
import { FakeIntersectionObserver, setVisibility, track } from './helpers';

const section = (name: string) => document.querySelector(`[data-analy-view="${name}"]`)!;
const show = (name: string, ratio: number) => FakeIntersectionObserver.show(section(name), ratio);
const views = (sent: Array<{ name: string; props: object }>) => sent.filter((e) => e.name === 'section_view').map((e) => e.props);

describe('sections', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    FakeIntersectionObserver.instances = [];
    document.body.innerHTML = '<section data-analy-view="pricing"></section><section data-analy-view="faq"></section>';
  });

  it('counts a section once it has been half visible for a second, timed from the start of the page view', async () => {
    const { sent } = track({ plugins: [sections()] });
    await vi.advanceTimersByTimeAsync(2000);
    show('pricing', 0.5);
    await vi.advanceTimersByTimeAsync(999);
    expect(views(sent)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'section_view', props: { section: 'pricing', timeToViewMs: 3000 } });
  });

  it('ignores brief glimpses and sections less than half visible', async () => {
    const { sent } = track({ plugins: [sections()] });
    show('pricing', 0.8);
    await vi.advanceTimersByTimeAsync(600);
    show('pricing', 0);
    show('faq', 0.3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(views(sent)).toEqual([]);
  });

  it('honours its ratio and visibleMs options', async () => {
    const { sent } = track({ plugins: [sections({ ratio: 0.25, visibleMs: 200 })] });
    show('faq', 0.3);
    await vi.advanceTimersByTimeAsync(200);
    expect(views(sent)).toEqual([{ section: 'faq', timeToViewMs: 200 }]);
  });

  it('counts each section once per page view, and again in the next page view', async () => {
    const { analy, sent } = track({ plugins: [sections()] });
    analy.page();
    show('pricing', 1);
    await vi.advanceTimersByTimeAsync(1000);
    show('pricing', 0);
    show('pricing', 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(views(sent)).toEqual([{ section: 'pricing', timeToViewMs: 1000 }]);

    // An SPA navigation: pricing is still on screen, so it counts again in the new page view.
    analy.page();
    await vi.advanceTimersByTimeAsync(1000);
    expect(views(sent)).toEqual([
      { section: 'pricing', timeToViewMs: 1000 },
      { section: 'pricing', timeToViewMs: 1000 },
    ]);
  });

  it('picks up sections added to the page later', async () => {
    const { sent } = track({ plugins: [sections()] });
    document.body.insertAdjacentHTML('beforeend', '<div><aside data-analy-view="late"></aside></div>');
    await vi.advanceTimersByTimeAsync(0);
    show('late', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(views(sent)).toEqual([{ section: 'late', timeToViewMs: 1000 }]);
  });

  it('does not count time while the tab is hidden', async () => {
    const { sent } = track({ plugins: [sections()] });
    show('pricing', 1);
    await vi.advanceTimersByTimeAsync(500);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5000);
    expect(views(sent)).toEqual([]);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1000);
    expect(views(sent)).toEqual([{ section: 'pricing', timeToViewMs: 6500 }]);
  });

  it('waits for a tab opened in the background to be shown', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const { sent } = track({ plugins: [sections()] });
    show('pricing', 1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(views(sent)).toEqual([]);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1000);
    expect(views(sent)).toEqual([{ section: 'pricing', timeToViewMs: 6000 }]);
  });

  it('stops its timers when the tracker is destroyed', async () => {
    const { analy } = track({ plugins: [sections()] });
    show('pricing', 1);
    expect(vi.getTimerCount()).toBe(1);
    analy.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing, and does not throw, without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onError = vi.fn();
    const { sent } = track({ plugins: [sections()], onError });
    expect(onError).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});
