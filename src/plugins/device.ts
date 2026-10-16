import type { DeviceContext, Plugin } from '../types';

type Parsed = Required<Pick<DeviceContext, 'browser' | 'browserVersion' | 'os' | 'deviceType'>>;

// Order matters: Edge, Opera and Samsung also carry "Chrome/", and Chrome carries "Safari".
const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/Version\/(\d+).*Safari/, 'Safari'],
];
const SYSTEMS: Array<[RegExp, string]> = [
  [/Windows NT/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

/** Browser, major version, OS and device type from a user-agent string. Reduced UAs still carry all four. */
export function parseUserAgent(ua: string, touchPoints = 0): Parsed {
  let browser = 'Other';
  let browserVersion = '';
  for (const [pattern, name] of BROWSERS) {
    const match = ua.match(pattern);
    if (match) {
      browser = name;
      browserVersion = match[1];
      break;
    }
  }
  // iPadOS 13+ claims to be a Mac; only the touch screen gives it away.
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  const os = ipad ? 'iOS' : (SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? 'Other');
  const deviceType = ipad || /Tablet|Android(?!.*Mobile)/.test(ua) ? 'tablet' : /Mobi|iPhone|iPod/.test(ua) ? 'mobile' : 'desktop';
  return { browser, browserVersion, os, deviceType };
}

/** Adds browser, browserVersion, os, deviceType, connection and colorScheme to every event's device. */
export function device(): Plugin {
  let extra: Partial<DeviceContext> = {};
  return {
    name: 'device',
    setup() {
      const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
      extra = {
        ...parseUserAgent(navigator.userAgent, navigator.maxTouchPoints),
        connection: connection?.effectiveType,
        colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      };
    },
    enrich(event) {
      event.device = { ...event.device, ...extra };
      return event;
    },
  };
}
