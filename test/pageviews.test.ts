import { describe, expect, it, vi } from 'vitest';
import { pageviews } from '../src/plugins/pageviews';
import { track } from './helpers';

describe('pageviews', () => {
  it('sends the first page view on setup and one per SPA navigation', () => {
    vi.useFakeTimers();
    const { sent } = track({ plugins: [pageviews()] });
    history.pushState(null, '', '/docs');
    vi.runAllTimers();
    history.replaceState(null, '', '/docs');
    vi.runAllTimers();
    history.pushState(null, '', '/docs?tab=api');
    vi.runAllTimers();

    expect(sent.map((e) => [e.name, e.page.path])).toEqual([
      ['pageview', '/'],
      ['pageview', '/docs'],
      ['pageview', '/docs'],
    ]);
    expect(sent[2].page.url).toMatch(/\/docs\?tab=api$/);
  });

  it('counts a page restored from the back/forward cache as a new page view', () => {
    const { sent } = track({ plugins: [pageviews()] });
    dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(sent.map((e) => e.name)).toEqual(['pageview', 'pageview']);
    expect(sent[1].page.viewId).not.toBe(sent[0].page.viewId);
  });

  it('ignores hash changes unless hash is enabled', () => {
    vi.useFakeTimers();
    const plain = track({ plugins: [pageviews()] });
    history.pushState(null, '', '#pricing');
    vi.runAllTimers();
    expect(plain.sent).toHaveLength(1);
    plain.analy.destroy();

    const hashed = track({ plugins: [pageviews({ hash: true })] });
    history.pushState(null, '', '#faq');
    vi.runAllTimers();
    expect(hashed.sent).toHaveLength(2);
  });
});
