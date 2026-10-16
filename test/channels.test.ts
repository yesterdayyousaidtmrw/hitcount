import { describe, expect, it, vi } from 'vitest';
import { channels, classifySource } from '../src/plugins/channels';
import { pageviews } from '../src/plugins/pageviews';
import { track } from './helpers';

describe('classifySource', () => {
  it.each([
    [undefined, undefined, { channel: 'direct', name: '' }],
    ['https://www.google.com/', undefined, { channel: 'search', name: 'google.com' }],
    ['https://www.google.co.uk/', undefined, { channel: 'search', name: 'google.co.uk' }],
    ['https://chatgpt.com/', undefined, { channel: 'ai', name: 'chatgpt.com' }],
    ['https://gemini.google.com/app', undefined, { channel: 'ai', name: 'gemini.google.com' }],
    ['https://claude.ai/chat/1', undefined, { channel: 'ai', name: 'claude.ai' }],
    ['https://mail.google.com/', undefined, { channel: 'email', name: 'mail.google.com' }],
    ['https://t.co/abc', undefined, { channel: 'social', name: 't.co' }],
    ['https://news.ycombinator.com/item?id=1', undefined, { channel: 'social', name: 'news.ycombinator.com' }],
    ['https://some-blog.dev/post', undefined, { channel: 'referral', name: 'some-blog.dev' }],
    ['https://shop.test/cart', undefined, { channel: 'internal', name: 'shop.test' }],
    [undefined, { source: 'chatgpt.com' }, { channel: 'ai', name: 'chatgpt.com' }],
    [undefined, { source: 'newsletter', medium: 'email' }, { channel: 'email', name: 'newsletter' }],
    ['https://www.google.com/', { source: 'google', medium: 'cpc' }, { channel: 'paid', name: 'google' }],
  ])('referrer %s, utm %o → %o', (referrer, utm, expected) => {
    expect(classifySource(referrer, utm, 'shop.test')).toEqual(expected);
  });
});

describe('channels plugin', () => {
  it('tags page views only', () => {
    const { analy, sent } = track({ plugins: [channels()] });
    analy.page();
    analy.track('click');
    expect(sent[0].source).toEqual({ channel: 'direct', name: '' });
    expect(sent[1].source).toBeUndefined();
  });
});

describe('first-touch attribution', () => {
  const DIRECT = { channel: 'direct', name: '', landing: '/' };

  it('stamps every event with where its session started, and starts again with a new session', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/pricing?utm_source=newsletter&utm_medium=email');
    const { analy, sent } = track({ plugins: [channels()] });
    analy.page();
    history.replaceState(null, '', '/docs');
    analy.page();
    analy.track('signup');
    const first = { channel: 'email', name: 'newsletter', landing: '/pricing', utm: { source: 'newsletter', medium: 'email' } };
    expect(sent.map((e) => e.attribution)).toEqual([first, first, first]);

    vi.advanceTimersByTime(31 * 60_000);
    history.replaceState(null, '', '/blog?utm_source=chatgpt.com');
    analy.page();
    analy.track('later');
    const second = { channel: 'ai', name: 'chatgpt.com', landing: '/blog', utm: { source: 'chatgpt.com' } };
    expect(sent[3].session).not.toBe(sent[2].session);
    expect(sent.slice(3).map((e) => e.attribution)).toEqual([second, second]);
  });

  it('carries the first touch to later page loads of the same session', () => {
    history.replaceState(null, '', '/landing?utm_source=chatgpt.com');
    track({ plugins: [channels()] }).analy.page();

    history.replaceState(null, '', '/next');
    const { analy, sent } = track({ plugins: [channels()] });
    analy.page();
    expect(sent[0].attribution).toEqual({ channel: 'ai', name: 'chatgpt.com', landing: '/landing', utm: { source: 'chatgpt.com' } });
  });

  it('attributes the page view that pageviews sends while plugins are still being set up', () => {
    const { sent } = track({ plugins: [pageviews(), channels()] });
    expect(sent[0]).toMatchObject({ name: 'pageview', attribution: DIRECT });
  });

  it('stores the first touch only once consent is granted', () => {
    const { analy, sent } = track({ consent: 'pending', plugins: [channels()] });
    analy.page();
    // Contract changed on request: persist defaults to 'local', so the first touch lives in localStorage.
    expect(localStorage.length).toBe(0);

    analy.consent('granted');
    expect(sent[0].attribution).toEqual(DIRECT);
    expect(localStorage.getItem('_analy_x_attribution')).toContain(sent[0].session);
  });

  it('starts a new first touch when the stored one cannot be read', () => {
    // Contract changed on request: persist defaults to 'local'.
    localStorage.setItem('_analy_x_attribution', '{not json');
    const onError = vi.fn();
    const { analy, sent } = track({ plugins: [channels()], onError });
    analy.page();
    expect(sent[0].attribution).toEqual(DIRECT);
    expect(onError).not.toHaveBeenCalled();
  });
});
