import { describe, expect, it } from 'vitest';
import { clicks } from '../src/plugins/clicks';
import { redact } from '../src/plugins/redact';
import { dispatchInShadow, openShadowRoot, track } from './helpers';

// Keep happy-dom from navigating when a test clicks a link.
document.addEventListener('click', (event) => event.preventDefault());

function clickOn(selector: string) {
  document.querySelector(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
}

describe('clicks', () => {
  it('sends data-analy elements as named events with data-analy-* props', () => {
    document.body.innerHTML = '<button data-analy="signup" data-analy-plan="pro"><span>Go</span></button>';
    const { sent } = track({ plugins: [clicks()] });
    clickOn('span');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'signup', props: { plan: 'pro' } });
  });

  it('reports outbound links with their full url', () => {
    document.body.innerHTML = '<a href="https://other.test/page?ref=me#top">x</a>';
    const { sent } = track({ plugins: [clicks()] });
    clickOn('a');
    expect(sent[0]).toMatchObject({ name: 'outbound', props: { url: 'https://other.test/page?ref=me#top' } });
  });

  it('blanks secret params in link urls with the redact plugin', () => {
    document.body.innerHTML = '<a href="https://other.test/page?token=abc&ref=me">x</a>';
    const { sent } = track({ plugins: [clicks(), redact()] });
    clickOn('a');
    expect(sent[0].props.url).toBe('https://other.test/page?token=redacted&ref=me');
  });

  it('reports downloads by extension or download attribute', () => {
    document.body.innerHTML = '<a id="pdf" href="/files/Report.PDF?sig=1">a</a><a id="attr" href="/export" download>b</a>';
    const { sent } = track({ plugins: [clicks()] });
    clickOn('#pdf');
    clickOn('#attr');
    expect(sent.map((e) => [e.name, e.props.file])).toEqual([
      ['download', 'Report.PDF'],
      ['download', 'export'],
    ]);
  });

  it('reports mailto/tel links as contact with the address', () => {
    document.body.innerHTML = '<a id="m" href="mailto:jane@example.com?subject=hi">m</a><a id="t" href="tel:+15551234">t</a>';
    const { sent } = track({ plugins: [clicks()] });
    clickOn('#m');
    clickOn('#t');
    expect(sent.map((e) => e.props)).toEqual([
      { channel: 'email', address: 'jane@example.com' },
      { channel: 'phone', address: '+15551234' },
    ]);
  });

  it('leaves the contact address out with the redact plugin', () => {
    document.body.innerHTML = '<a id="m" href="mailto:jane@example.com">m</a>';
    const { sent } = track({ plugins: [clicks(), redact()] });
    clickOn('#m');
    expect(sent[0].props).toEqual({ channel: 'email' });
  });

  it('tracks tagged elements and links inside an open shadow root, not just its host', () => {
    const root = openShadowRoot('<button data-analy="signup" data-analy-plan="pro"><span>Go</span></button><a href="https://other.test/x">x</a>');
    const { sent } = track({ plugins: [clicks()] });
    for (const selector of ['span', 'a']) {
      dispatchInShadow(root.querySelector(selector)!, new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
    }
    expect(sent.map((e) => [e.name, e.props])).toEqual([
      ['signup', { plan: 'pro' }],
      ['outbound', { url: 'https://other.test/x' }],
    ]);
  });

  it('ignores ordinary internal links and untagged elements', () => {
    document.body.innerHTML = '<a href="/about">about</a><p>text</p>';
    const { sent } = track({ plugins: [clicks()] });
    clickOn('a');
    clickOn('p');
    expect(sent).toHaveLength(0);
  });
});
