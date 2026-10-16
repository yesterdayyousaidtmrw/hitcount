import { describe, expect, it, vi } from 'vitest';
import { turnstile } from '../src/plugins/turnstile';
import { track } from './helpers';

// The markup Turnstile renders, as seen in a real browser with Cloudflare's test sitekeys.
function renderWidget(id: string) {
  const container = document.createElement('div');
  container.id = id;
  container.innerHTML = '<div><div tabindex="0"></div><input type="hidden" name="cf-turnstile-response"></div>';
  document.body.append(container);
  return {
    input: container.querySelector('input')!,
    host: container.querySelector<HTMLElement>('[tabindex]')!,
  };
}

describe('turnstile', () => {
  it('reports shown, solved with time-to-solve, then expired', async () => {
    // Only Date is faked; a real timer tick lets MutationObserver callbacks run without moving the clock.
    vi.useFakeTimers({ toFake: ['Date'] });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const { sent } = track({ plugins: [turnstile()] });
    const { input } = renderWidget('signup-check');
    await settle();

    vi.setSystemTime(Date.now() + 1200);
    input.setAttribute('value', 'XXXX.DUMMY.TOKEN.XXXX');
    await settle();
    input.setAttribute('value', '');
    await settle();

    expect(sent.map((e) => e.props)).toEqual([
      { status: 'shown', widget: 'div#signup-check' },
      { status: 'solved', widget: 'div#signup-check', ms: 1200 },
      { status: 'expired', widget: 'div#signup-check' },
    ]);
  });

  it('picks up a widget that was already rendered before the plugin started', () => {
    const { input } = renderWidget('early');
    input.setAttribute('value', 'token');
    const { sent } = track({ plugins: [turnstile()] });
    expect(sent.map((e) => e.props.status)).toEqual(['shown', 'solved']);
  });

  it('reports clicked when focus moves into the widget (interactive challenge)', async () => {
    const { sent } = track({ plugins: [turnstile()] });
    const { host } = renderWidget('w');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    host.focus();
    dispatchEvent(new Event('blur'));
    expect(sent[1].props).toEqual({ status: 'clicked', widget: 'div#w' });
  });
});
