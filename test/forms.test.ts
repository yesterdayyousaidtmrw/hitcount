import { describe, expect, it } from 'vitest';
import { forms } from '../src/plugins/forms';
import { redact } from '../src/plugins/redact';
import { setVisibility, track } from './helpers';

function type(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

const submit = () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const unload = () => dispatchEvent(new Event('pagehide'));

describe('forms', () => {
  it('sends a tagged form as a named event on submit, with its values', () => {
    document.body.innerHTML = '<form data-analy="newsletter" data-analy-source="footer"><input name="email"></form>';
    const { sent } = track({ plugins: [forms()] });
    type('[name=email]', 'jane@example.com');
    submit();
    expect(sent[0]).toMatchObject({
      name: 'newsletter',
      props: { source: 'footer', values: { email: 'jane@example.com' } },
    });
  });

  it('reports a started form left on unload, with what was typed', () => {
    document.body.innerHTML = '<form id="checkout"><input name="email"><input name="card"></form>';
    const { sent, names } = track({ plugins: [forms()] });
    type('[name=email]', 'jane@example.com');
    type('[name=card]', '4242424242424242');

    setVisibility('hidden');
    expect(names()).toEqual([]);
    unload();

    expect(sent[0]).toMatchObject({
      name: 'form_abandon',
      props: {
        form: 'checkout',
        fieldsTouched: 2,
        lastField: 'card',
        values: { email: 'jane@example.com', card: '4242424242424242' },
      },
    });
  });

  it('sends field names only, no values, with the redact plugin', () => {
    document.body.innerHTML = '<form data-analy="signup"><input name="email"></form>';
    const { sent } = track({ plugins: [forms(), redact()] });
    type('[name=email]', 'jane@example.com');
    unload();
    submit();
    expect(sent.map((e) => e.props.values)).toEqual([undefined, undefined]);
    expect(JSON.stringify(sent)).not.toContain('jane');
  });

  it('does not report a form that was submitted', () => {
    document.body.innerHTML = '<form id="f"><input name="q"></form>';
    const { names } = track({ plugins: [forms()] });
    type('[name=q]', 'shoes');
    submit();
    unload();
    expect(names()).toEqual([]);
  });

  it('skips forms marked data-analy-ignore', () => {
    document.body.innerHTML = '<form data-analy-ignore><input name="q"></form>';
    const { names } = track({ plugins: [forms()] });
    type('[name=q]', 'x');
    unload();
    expect(names()).toEqual([]);
  });
});
