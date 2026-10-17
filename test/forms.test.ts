import { describe, expect, it, vi } from 'vitest';
import { forms } from '../src/plugins/forms';
import { redact } from '../src/plugins/redact';
import type { HitcountEvent } from '../src/types';
import { dispatchInShadow, openShadowRoot, setVisibility, track } from './helpers';

function fire(selector: string, event: Event, root: Document | ShadowRoot = document) {
  const field = root.querySelector(selector)!;
  if (root instanceof ShadowRoot) dispatchInShadow(field, event);
  else field.dispatchEvent(event);
}

// Real input, focusin and focusout events are composed: they cross shadow roots on their way to
// the document. Real change, invalid and submit events are not.
function type(selector: string, value: string, root: Document | ShadowRoot = document) {
  root.querySelector<HTMLInputElement>(selector)!.value = value;
  fire(selector, new Event('input', { bubbles: true, composed: true }), root);
}
const focus = (selector: string, root?: ShadowRoot) =>
  fire(selector, new FocusEvent('focusin', { bubbles: true, composed: true }), root);
const blur = (selector: string, root?: ShadowRoot) =>
  fire(selector, new FocusEvent('focusout', { bubbles: true, composed: true }), root);
const change = (selector: string, root?: ShadowRoot) => fire(selector, new Event('change', { bubbles: true }), root);
const field = (selector: string, root: ParentNode = document) => root.querySelector<HTMLInputElement>(selector)!;

const submit = (root: ParentNode = document) =>
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const unload = () => dispatchEvent(new Event('pagehide'));
const propsOf = (sent: HitcountEvent[], name: string) => sent.filter((e) => e.name === name).map((e) => e.props);

describe('forms', () => {
  it('sends a tagged form as a named event on submit, with its values', () => {
    document.body.innerHTML = '<form data-hitcount="newsletter" data-hitcount-source="footer"><input name="email"></form>';
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

    // A tab switch is not abandonment; it only snapshots the progress so far.
    setVisibility('hidden');
    expect(names()).toEqual(['form_snapshot']);
    unload();

    expect(sent[1]).toMatchObject({
      name: 'form_abandon',
      props: {
        form: 'checkout',
        fieldsTouched: 2,
        lastField: 'card',
        values: { email: 'jane@example.com', card: '4242424242424242' },
        completion: 100,
      },
    });
  });

  it('sends field names only, no values, with the redact plugin', () => {
    document.body.innerHTML = '<form data-hitcount="signup"><input name="email" type="email"></form>';
    const { sent, names } = track({ plugins: [forms(), redact()] });
    focus('[name=email]');
    type('[name=email]', 'jane@example.com');
    change('[name=email]');
    setVisibility('hidden');
    field('[name=email]').setCustomValidity('jane@example.com is taken');
    field('[name=email]').checkValidity();
    unload();
    submit();
    expect(names()).toEqual(['form_progress', 'form_snapshot', 'form_error', 'form_abandon', 'signup']);
    expect(sent.map((e) => [e.props.values, e.props.value, e.props.message])).toEqual(Array(5).fill([undefined, undefined, undefined]));
    expect(JSON.stringify(sent)).not.toContain('jane');
  });

  it('does not report a form that was submitted', () => {
    document.body.innerHTML = '<form id="f"><input name="q"></form>';
    const { names } = track({ plugins: [forms()] });
    type('[name=q]', 'shoes');
    submit();
    setVisibility('hidden');
    unload();
    expect(names()).toEqual([]);
  });

  it('tracks submits and abandonment of forms inside an open shadow root', () => {
    vi.useFakeTimers();
    const root = openShadowRoot('<form data-hitcount="newsletter"><input name="email"></form><form id="checkout"><input name="card"></form>');
    const { sent } = track({ plugins: [forms()] });
    type('[name=email]', 'jane', root);
    type('[name=email]', 'jane@example.com', root);
    type('[name=card]', '4242', root);
    vi.advanceTimersByTime(500);
    submit(root);
    unload();
    expect(sent.map((e) => [e.name, e.props])).toEqual([
      ['newsletter', { values: { email: 'jane@example.com' }, completion: 100, msInForm: 500 }],
      [
        'form_abandon',
        { form: 'checkout', fieldsTouched: 1, lastField: 'card', values: { card: '4242' }, completion: 100, msInForm: 500 },
      ],
    ]);
  });

  it('tracks a form inside a shadow root that is submitted without typing in it', () => {
    const root = openShadowRoot('<form data-hitcount="newsletter"><input name="email" value="jane@example.com"></form>');
    const { names } = track({ plugins: [forms()] });
    focus('[name=email]', root);
    submit(root);
    expect(names()).toEqual(['newsletter']);
  });

  it('names a design-system input in a light-DOM form by its host, as before', () => {
    document.body.innerHTML = '<form id="signup"><x-input name="email"></x-input></form>';
    const inner = document.querySelector('x-input')!.attachShadow({ mode: 'open' });
    inner.innerHTML = '<input>';
    const { sent } = track({ plugins: [forms()] });
    type('input', 'jane@example.com', inner);
    unload();
    expect(sent[0]).toMatchObject({ name: 'form_abandon', props: { form: 'signup', fieldsTouched: 1, lastField: 'email' } });
  });

  it('skips forms marked data-hitcount-ignore', () => {
    document.body.innerHTML = '<form data-hitcount-ignore><input name="q" required></form>';
    const { names } = track({ plugins: [forms()] });
    focus('[name=q]');
    type('[name=q]', 'x');
    change('[name=q]');
    blur('[name=q]');
    field('[name=q]').value = '';
    field('[name=q]').checkValidity();
    setVisibility('hidden');
    unload();
    expect(names()).toEqual([]);
  });
});

describe('form progress', () => {
  const SIGNUP = `<form id="signup">
    <input name="email"><input name="name"><input type="hidden" name="csrf" value="t"><input name="promo" disabled>
    <input type="radio" name="plan" value="free"><input type="radio" name="plan" value="pro">
    <button name="go">Go</button></form>`;

  it('sends form_progress each time a field is finished, with its place, the fill and the time on it', () => {
    vi.useFakeTimers();
    document.body.innerHTML = SIGNUP;
    const { sent } = track({ plugins: [forms()] });
    focus('[name=email]');
    type('[name=email]', 'jane@example.com');
    vi.advanceTimersByTime(1500);
    change('[name=email]');
    blur('[name=email]');
    // A component that never fires change: leaving the field changed is what finishes it.
    focus('[name=name]');
    type('[name=name]', 'Jane');
    vi.advanceTimersByTime(800);
    blur('[name=name]');
    focus('[value=pro]');
    field('[value=pro]').checked = true;
    change('[value=pro]');
    blur('[value=pro]');

    // Hidden, disabled and button fields are not counted; the radio group is one field.
    expect(propsOf(sent, 'form_progress')).toEqual([
      { form: 'signup', field: 'email', position: 1, filled: 1, total: 3, msOnField: 1500, value: 'jane@example.com' },
      { form: 'signup', field: 'name', position: 2, filled: 2, total: 3, msOnField: 800, value: 'Jane' },
      { form: 'signup', field: 'plan', position: 3, filled: 3, total: 3, msOnField: 0, value: 'pro' },
    ]);
  });

  it('does not send for a field left as it was', () => {
    document.body.innerHTML = SIGNUP;
    const { names } = track({ plugins: [forms()] });
    focus('[name=email]');
    blur('[name=email]');
    focus('[name=name]');
    type('[name=name]', 'J');
    type('[name=name]', '');
    blur('[name=name]');
    expect(names()).toEqual([]);
  });

  it('sends a checkbox value only while checked, and a file input by file name', () => {
    document.body.innerHTML = '<form id="apply"><input type="checkbox" name="news" value="yes"><input type="file" name="cv"></form>';
    const { sent } = track({ plugins: [forms()] });
    field('[name=news]').checked = true;
    change('[name=news]');
    field('[name=news]').checked = false;
    change('[name=news]');
    Object.defineProperty(field('[name=cv]'), 'files', { value: [new File(['cv'], 'jane-cv.pdf')] });
    change('[name=cv]');
    expect(propsOf(sent, 'form_progress').map(({ field, value, filled }) => [field, value, filled])).toEqual([
      ['news', 'yes', 1],
      ['news', '', 0],
      ['cv', 'jane-cv.pdf', 1],
    ]);
  });

  it('gives a field the form does not count no position', () => {
    document.body.innerHTML = '<form id="search"><input id="q"></form>';
    const { sent } = track({ plugins: [forms()] });
    field('#q').value = 'shoes';
    change('#q');
    expect(propsOf(sent, 'form_progress')).toEqual([
      { form: 'search', field: 'q', position: null, filled: 0, total: 0, msOnField: 0, value: 'shoes' },
    ]);
  });

  it('finishes a field inside a shadow-root form', () => {
    const root = openShadowRoot('<form id="checkout"><input name="card"><input name="zip"></form>');
    const { sent } = track({ plugins: [forms()] });
    focus('[name=card]', root);
    type('[name=card]', '4242', root);
    change('[name=card]', root);
    blur('[name=card]', root);
    expect(propsOf(sent, 'form_progress')).toMatchObject([
      { form: 'checkout', field: 'card', position: 1, filled: 1, total: 2, value: '4242' },
    ]);
  });
});

describe('form snapshots', () => {
  it('snapshots a started form each time the tab is hidden after it changed', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<form id="checkout"><input name="email"><input name="card"></form>';
    const { sent, names } = track({ plugins: [forms()] });
    focus('[name=email]');
    vi.advanceTimersByTime(2000);
    type('[name=email]', 'jane@example.com');
    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('hidden');
    setVisibility('visible');
    vi.advanceTimersByTime(1000);
    type('[name=card]', '4242');
    setVisibility('hidden');
    unload();

    expect(names()).toEqual(['form_snapshot', 'form_snapshot', 'form_abandon']);
    expect(propsOf(sent, 'form_snapshot')).toEqual([
      {
        form: 'checkout', fieldsTouched: 1, lastField: 'email', filled: 1, total: 2, completion: 50, msInForm: 2000,
        values: { email: 'jane@example.com', card: '' },
      },
      {
        form: 'checkout', fieldsTouched: 2, lastField: 'card', filled: 2, total: 2, completion: 100, msInForm: 3000,
        values: { email: 'jane@example.com', card: '4242' },
      },
    ]);
  });

  it('does not snapshot a form that was only focused, and abandons a started one on a page change', () => {
    document.body.innerHTML = '<form id="a"><input name="x"></form><form id="b"><input name="y"></form>';
    const { hitcount, names } = track({ plugins: [forms()] });
    hitcount.page();
    focus('[name=x]');
    setVisibility('hidden');
    setVisibility('visible');
    type('[name=y]', 'typed');
    hitcount.page();
    expect(names()).toEqual(['pageview', 'form_abandon', 'pageview']);
  });
});

describe('form completion', () => {
  it('adds completion and time in form to the tagged submit event', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<form data-hitcount="signup"><input name="email"><input name="name"><input name="phone"></form>';
    const { sent } = track({ plugins: [forms()] });
    focus('[name=email]');
    vi.advanceTimersByTime(3000);
    type('[name=email]', 'jane@example.com');
    vi.advanceTimersByTime(1000);
    submit();
    expect(sent[0].props).toEqual({ values: { email: 'jane@example.com', name: '', phone: '' }, completion: 33, msInForm: 4000 });
  });

  it('sends null for what it cannot know: no interaction, nothing named to count', () => {
    document.body.innerHTML = '<form data-hitcount="go"><input></form>';
    const { sent } = track({ plugins: [forms()] });
    submit();
    expect(sent[0].props).toEqual({ values: {}, completion: null, msInForm: null });
  });
});

describe('form errors', () => {
  const SIGNUP =
    '<form id="signup"><input name="email" type="email" required><input name="pass" minlength="8"><input name="age" type="number" min="18"></form>';

  it('sends form_error with the failing check and the browser message for each field it refuses', () => {
    document.body.innerHTML = SIGNUP;
    const { sent } = track({ plugins: [forms()] });
    field('[name=email]').checkValidity();
    field('[name=email]').value = 'jane';
    field('[name=pass]').value = 'abc';
    field('[name=age]').value = '12';
    document.querySelector('form')!.requestSubmit();
    field('[name=email]').value = 'jane@example.com';
    field('[name=email]').setCustomValidity('Use your work email');
    field('[name=email]').checkValidity();

    const message = field('[name=pass]').validationMessage;
    expect(message).not.toBe('');
    expect(propsOf(sent, 'form_error')).toEqual([
      { form: 'signup', field: 'email', reason: 'valueMissing', message },
      { form: 'signup', field: 'email', reason: 'typeMismatch', message },
      { form: 'signup', field: 'pass', reason: 'tooShort', message },
      { form: 'signup', field: 'age', reason: 'rangeUnderflow', message },
      { form: 'signup', field: 'email', reason: 'customError', message: 'Use your work email' },
    ]);
  });

  it('sends form_error from a form inside a shadow root', () => {
    const root = openShadowRoot(SIGNUP);
    const { sent } = track({ plugins: [forms()] });
    focus('[name=email]', root);
    root.querySelector('form')!.requestSubmit();
    expect(propsOf(sent, 'form_error')).toMatchObject([{ form: 'signup', field: 'email', reason: 'valueMissing' }]);
  });

  it('ignores an invalid event no check explains', () => {
    document.body.innerHTML = SIGNUP;
    const { names } = track({ plugins: [forms()] });
    field('[name=pass]').dispatchEvent(new Event('invalid', { cancelable: true }));
    expect(names()).toEqual([]);
  });
});
