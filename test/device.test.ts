import { describe, expect, it } from 'vitest';
import { device, parseUserAgent } from '../src/plugins/device';
import { track } from './helpers';

describe('parseUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      { browser: 'Chrome', browserVersion: '141', os: 'Windows', deviceType: 'desktop' },
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      { browser: 'Edge', browserVersion: '141', os: 'Windows', deviceType: 'desktop' },
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
      { browser: 'Safari', browserVersion: '18', os: 'macOS', deviceType: 'desktop' },
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
      { browser: 'Chrome', browserVersion: '141', os: 'iOS', deviceType: 'mobile' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
      { browser: 'Samsung Internet', browserVersion: '28', os: 'Android', deviceType: 'mobile' },
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      { browser: 'Chrome', browserVersion: '141', os: 'Android', deviceType: 'tablet' },
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
      { browser: 'Firefox', browserVersion: '143', os: 'Linux', deviceType: 'desktop' },
    ],
  ])('%s', (ua, expected) => {
    expect(parseUserAgent(ua)).toEqual(expected);
  });

  it('spots an iPad that reports itself as a Mac by its touch screen', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
    expect(parseUserAgent(ua, 5)).toMatchObject({ os: 'iOS', deviceType: 'tablet' });
  });
});

describe('device plugin', () => {
  it('adds the parsed browser, os, type and colour scheme to every event', () => {
    const { hitcount, sent } = track({ plugins: [device()] });
    hitcount.track('a');
    expect(sent[0].device).toMatchObject({
      browser: expect.any(String),
      os: expect.any(String),
      deviceType: expect.stringMatching(/^(mobile|tablet|desktop)$/),
      colorScheme: expect.stringMatching(/^(light|dark)$/),
    });
  });
});
