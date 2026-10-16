import { describe, expect, it } from 'vitest';
import { channels, classifySource } from '../src/plugins/channels';
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
