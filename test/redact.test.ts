import { describe, expect, it } from 'vitest';
import { channels } from '../src/plugins/channels';
import { fingerprint } from '../src/plugins/fingerprint';
import { createRedactor, redact, redactText } from '../src/plugins/redact';
import { track } from './helpers';

describe('createRedactor', () => {
  const scrub = createRedactor(['ref_code']);

  it.each([
    ['https://a.test/?token=abc&x=1', 'https://a.test/?token=redacted&x=1'],
    ['https://a.test/cb#access_token=t&expires=3600', 'https://a.test/cb#access_token=redacted&expires=3600'],
    ['https://a.test/#/route?code=9&STATE=s', 'https://a.test/#/route?code=redacted&STATE=redacted'],
    ['https://a.test/?ref_code=z', 'https://a.test/?ref_code=redacted'],
    ['https://a.test/u/jane.doe%40mail.com', 'https://a.test/u/[email]'],
    ['https://a.test/search?q=shoes&page=2', 'https://a.test/search?q=shoes&page=2'],
  ])('%s → %s', (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it('replaces email addresses in free text', () => {
    expect(redactText('failed for jane@example.com and bob@x.io')).toBe('failed for [email] and [email]');
  });
});

describe('redact plugin', () => {
  it('blanks secrets and emails in page, utm and props, drops values/address, keeps the user id', () => {
    history.replaceState(null, '', '/u/jane@example.com?token=abc&ok=1&utm_content=jane@example.com#access_token=xyz');
    document.title = 'Inbox jane@example.com';
    const { hitcount, sent } = track({ plugins: [redact()] });
    hitcount.identify('jane@example.com');
    hitcount.track('note', { text: 'mail jane@example.com', values: { email: 'x' }, address: '+1555', nested: ['a@b.co'] });

    const [, note] = sent;
    expect(note.page.url).toMatch(/\?token=redacted&ok=1&utm_content=\[email\]#access_token=redacted$/);
    expect(note.page.path).toBe('/u/[email]');
    expect(note.page.title).toBe('Inbox [email]');
    expect(note.utm).toEqual({ content: '[email]' });
    expect(note.props).toEqual({ text: 'mail [email]', nested: ['[email]'] });
    expect(note.user).toBe('jane@example.com');
  });

  it('blanks emails in the first-touch attribution', () => {
    history.replaceState(null, '', '/u/jane@example.com?utm_content=jane@example.com');
    const { hitcount, sent } = track({ plugins: [channels(), redact()] });
    hitcount.page();
    expect(sent[0].attribution).toEqual({ channel: 'direct', name: '', landing: '/u/[email]', utm: { content: '[email]' } });
  });

  it('drops what a visitor typed from form_progress and form_error, and keeps value on other events', () => {
    const { hitcount, sent } = track({ plugins: [redact()] });
    hitcount.track('form_progress', { form: 'f', field: 'email', position: 1, filled: 1, total: 1, msOnField: 0, value: 'jane' });
    hitcount.track('form_error', { form: 'f', field: 'email', reason: 'typeMismatch', message: "'jane' is missing an '@'" });
    hitcount.track('purchase', { value: 49 });
    expect(sent.map((e) => e.props)).toEqual([
      { form: 'f', field: 'email', position: 1, filled: 1, total: 1, msOnField: 0 },
      { form: 'f', field: 'email', reason: 'typeMismatch' },
      { value: 49 },
    ]);
  });

  it('drops the device fingerprint, which identifies a person as surely as an IP', () => {
    const { hitcount, sent } = track({ plugins: [fingerprint(), redact()] });
    hitcount.track('note');
    expect(sent[0]).not.toHaveProperty('fingerprint');
  });

  it('sends everything as-is when it is not installed', () => {
    history.replaceState(null, '', '/u/jane@example.com?token=abc');
    const { hitcount, sent } = track();
    hitcount.track('note', { text: 'jane@example.com' });
    expect(sent[0].page.url).toBe(location.href);
    expect(sent[0].props.text).toBe('jane@example.com');
  });
});
