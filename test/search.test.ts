import { describe, expect, it, vi } from 'vitest';
import { pageviews } from '../src/plugins/pageviews';
import { search } from '../src/plugins/search';
import type { HitcountEvent } from '../src/types';
import { setVisibility, track } from './helpers';

const searches = (sent: HitcountEvent[]) => sent.filter((e) => e.name === 'search');

describe('search plugin', () => {
  it('sends the query and its param for each page view that has one', () => {
    vi.useFakeTimers();
    const { hitcount, sent } = track({ plugins: [search()] });
    for (const url of ['/find?page=2&query=red+shoes', '/about', '/blog?s=', '/find?s=ignored&q=%20boots%20']) {
      history.replaceState(null, '', url);
      hitcount.page();
    }
    vi.advanceTimersByTime(2000);
    expect(searches(sent).map((e) => e.props)).toEqual([
      { query: 'red shoes', param: 'query' },
      { query: 'boots', param: 'q' },
    ]);
  });

  it('waits for SPA results to render, skipping the count the last search left on screen', async () => {
    document.body.innerHTML = '<p data-hitcount-results="12">12 results</p>';
    history.replaceState(null, '', '/search?q=boots');
    const { hitcount, sent } = track({ plugins: [search()] });
    hitcount.page();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(searches(sent)).toHaveLength(0);

    document.body.innerHTML = '<p data-hitcount-results="7">7 results</p>';
    // Well inside the 2s fallback: only the new count can have sent it.
    await vi.waitFor(() => expect(searches(sent)).toHaveLength(1), { timeout: 500 });
    expect(searches(sent)[0]).toMatchObject({
      props: { query: 'boots', param: 'q', results: 7 },
      page: { path: '/search', viewId: sent[0].page.viewId },
    });
  });

  it('reads a count that was on the page from the start once the page settles', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<p data-hitcount-results="3">3 results</p>';
    history.replaceState(null, '', '/?q=boots');
    const { hitcount, sent } = track({ plugins: [search()] });
    hitcount.page();
    vi.advanceTimersByTime(1999);
    expect(searches(sent)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(searches(sent)[0].props).toEqual({ query: 'boots', param: 'q', results: 3 });
  });

  it('sends right away when the page is hidden, leaving out a count that is not a number', () => {
    document.body.innerHTML = '<p data-hitcount-results="lots">lots of results</p>';
    history.replaceState(null, '', '/?q=boots');
    const { hitcount, sent } = track({ plugins: [search()] });
    hitcount.page();
    setVisibility('hidden');
    expect(searches(sent).map((e) => e.props)).toEqual([{ query: 'boots', param: 'q' }]);
  });

  it('catches the first page view when pageviews is set up before it', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/?q=boots');
    const { sent } = track({ plugins: [pageviews(), search()] });
    vi.advanceTimersByTime(2000);
    expect(searches(sent)).toHaveLength(1);
  });

  it('takes its params from the options', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/?q=ignored&k=lamp');
    const { hitcount, sent } = track({ plugins: [search({ params: ['k'] })] });
    hitcount.page();
    vi.advanceTimersByTime(2000);
    expect(searches(sent).map((e) => e.props)).toEqual([{ query: 'lamp', param: 'k' }]);
  });

  it('sends nothing after destroy()', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/?q=boots');
    const { hitcount, sent } = track({ plugins: [search()] });
    hitcount.page();
    hitcount.destroy();
    vi.advanceTimersByTime(2000);
    expect(searches(sent)).toHaveLength(0);
  });
});
