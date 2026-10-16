import type { DeviceContext, Utm } from '../types';

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

export function deviceContext(): DeviceContext {
  return {
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`,
    touch: navigator.maxTouchPoints > 0,
    userAgent: navigator.userAgent,
  };
}

export function utmFrom(search: string): Utm | undefined {
  const params = new URLSearchParams(search);
  let utm: Utm | undefined;
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`);
    if (value) (utm ??= {})[key] = value;
  }
  return utm;
}
