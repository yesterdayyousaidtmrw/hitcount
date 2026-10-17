import type { FormAbandonProps, FormErrorProps } from '../events';
import type { Plugin } from '../types';
import { ATTRIBUTE, attributeProps, closestInPath, describe, targetElement } from '../core/dom';

interface Progress {
  /** When the visitor first focused or typed in the form. */
  since: number;
  /** Fields typed in or finished; empty while the form has only been focused. */
  fields: Set<string>;
  lastField: string;
  /** Changed since the last form_snapshot. */
  changed: boolean;
}

/** The field being edited: when it was focused, and its value then or at its last finish. */
interface Focus {
  control: Element;
  at: number;
  value: string;
}

interface FieldCount {
  /** Names of the fields a visitor fills in, in form order. */
  names: string[];
  filled: number;
}

// form_error reports the first of these that fails.
const REASONS: Array<FormErrorProps['reason']> = [
  'valueMissing', 'typeMismatch', 'patternMismatch', 'tooShort', 'tooLong',
  'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError',
];
// Members of form.elements a visitor does not fill in.
const UNFILLED = /^(button|fieldset|object|output|input:(hidden|submit|reset|button|image))$/;

/** Named fields as the browser would submit them; files reduce to their file name. */
function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  new FormData(form).forEach((value, key) => {
    values[key] = typeof value === 'string' ? value : value.name;
  });
  return values;
}

/** What a field holds: a file input's file names, a checkbox or radio's value while checked. */
function fieldValue(field: Element): string {
  if (field instanceof HTMLInputElement) {
    if (field.type === 'file') return Array.from(field.files ?? [], (file) => file.name).join(', ');
    if (field.type === 'checkbox' || field.type === 'radio') return field.checked ? field.value : '';
  }
  const value: unknown = (field as HTMLInputElement).value;
  return typeof value === 'string' ? value : '';
}

/**
 * The named, enabled fields a visitor fills in, and how many hold a value. A radio group or
 * checkboxes sharing a name are one field. Read from the controls, not new FormData(form): that
 * fires the form's formdata event, which pages use to add to a real submission, on every finish.
 */
function countFields(form: HTMLFormElement): FieldCount {
  const names = new Set<string>();
  const filled = new Set<string>();
  for (const control of Array.from(form.elements)) {
    const name = control.getAttribute('name');
    const kind = control instanceof HTMLInputElement ? `input:${control.type}` : control.tagName.toLowerCase();
    if (!name || UNFILLED.test(kind) || control.matches(':disabled')) continue;
    names.add(name);
    if (fieldValue(control)) filled.add(name);
  }
  return { names: [...names], filled: filled.size };
}

/** filled / total as a whole percentage; null when nothing is named, rather than a made-up 0 or 100. */
const completion = ({ names, filled }: FieldCount) => (names.length ? Math.round((filled / names.length) * 100) : null);

const fieldKey = (field: Element) => field.getAttribute('name') || field.getAttribute('id') || field.tagName.toLowerCase();

/**
 * The form an event belongs to, across open shadow roots, and the field as that form sees it: for
 * a design-system input inside a light-DOM form that is the component's host, which carries the
 * name, not the input inside it.
 */
function fieldAndForm(event: Event): [Element, HTMLFormElement] | undefined {
  const form = closestInPath<HTMLFormElement>(event, 'form');
  if (!form) return undefined;
  const root = form.getRootNode();
  const path = event.composedPath?.() ?? [event.target];
  const field = path.find((node): node is Element => node instanceof Element && node.getRootNode() === root);
  return field ? [field, form] : undefined;
}

/**
 * <form data-analy="signup"> sends `signup` on submit. Each field a visitor finishes sends
 * `form_progress`, each value the browser refuses sends `form_error`, and a started form sends
 * `form_snapshot` when the tab is hidden and `form_abandon` when the page is left without
 * submitting it. They carry what was typed (the redact plugin removes it). Add data-analy-ignore
 * to a form to skip it.
 */
export function forms(): Plugin {
  return {
    name: 'forms',
    setup(analy) {
      const progress = new Map<HTMLFormElement, Progress>();
      let focus: Focus | undefined;
      // submit, change and invalid are not composed: from a form inside a shadow root they never
      // reach the document, so such a form gets its own listeners once a visitor focuses or types
      // in it. Teardown cannot find those listeners again; they stay, like the history wrap in
      // pageviews, and a destroyed tracker sends nothing.
      const shadowForms = new WeakSet<HTMLFormElement>();

      const formName = (form: HTMLFormElement) =>
        form.getAttribute(ATTRIBUTE) || form.getAttribute('id') || form.getAttribute('name') || describe(form);

      /** The field, form and the control the event started on, unless the form is ignored. */
      const watched = (event: Event) => {
        const [field, form] = fieldAndForm(event) ?? [];
        if (!field || !form || form.hasAttribute(`${ATTRIBUTE}-ignore`)) return undefined;
        if (form.getRootNode() instanceof ShadowRoot && !shadowForms.has(form)) {
          shadowForms.add(form);
          form.addEventListener('submit', onSubmit);
          form.addEventListener('change', onFinish);
          form.addEventListener('invalid', onInvalid, true);
        }
        return { field, form, control: targetElement(event) ?? field };
      };
      const begin = (form: HTMLFormElement) => {
        const state = progress.get(form) ?? { since: Date.now(), fields: new Set<string>(), lastField: '', changed: false };
        progress.set(form, state);
        return state;
      };
      const touch = (form: HTMLFormElement, field: Element) => {
        const state = begin(form);
        state.lastField = fieldKey(field);
        state.fields.add(state.lastField);
        state.changed = true;
      };
      const summary = (form: HTMLFormElement, { since, fields, lastField }: Progress, count: FieldCount): FormAbandonProps => ({
        form: formName(form),
        fieldsTouched: fields.size,
        lastField,
        values: formValues(form),
        completion: completion(count),
        msInForm: Date.now() - since,
      });

      const onInput = (event: Event) => {
        const target = watched(event);
        if (target) touch(target.form, target.field);
      };
      const onFocusIn = (event: Event) => {
        const target = watched(event);
        if (!target) return;
        begin(target.form);
        focus = { control: target.control, at: Date.now(), value: fieldValue(target.control) };
      };
      // change commits an edit; a field left changed without one (a component that never fires
      // change) is finished on focusout. The change before a blur moves the baseline, so one edit
      // is reported once.
      const onFocusOut = (event: Event) => {
        if (!focus || focus.control !== targetElement(event)) return;
        if (fieldValue(focus.control) !== focus.value) onFinish(event);
        focus = undefined;
      };
      const onFinish = (event: Event) => {
        const target = watched(event);
        if (!target) return;
        const { field, form, control } = target;
        const value = fieldValue(control);
        const focused = focus?.control === control ? focus : undefined;
        if (focused) focused.value = value;
        touch(form, field);
        const count = countFields(form);
        analy.track('form_progress', {
          form: formName(form),
          field: fieldKey(field),
          position: count.names.indexOf(field.getAttribute('name') ?? '') + 1 || null,
          filled: count.filled,
          total: count.names.length,
          msOnField: focused ? Date.now() - focused.at : 0,
          value,
        });
      };
      const onInvalid = (event: Event) => {
        const target = watched(event);
        if (!target) return;
        const { validity, validationMessage } = target.control as HTMLInputElement;
        // An invalid event no check explains came from a script, not from the browser refusing a value.
        const reason = validity && REASONS.find((check) => validity[check]);
        if (reason) {
          analy.track('form_error', { form: formName(target.form), field: fieldKey(target.field), reason, message: validationMessage });
        }
      };
      const onSubmit = (event: Event) => {
        const form = targetElement(event);
        if (!(form instanceof HTMLFormElement)) return;
        const state = progress.get(form);
        progress.delete(form);
        const name = form.getAttribute(ATTRIBUTE);
        if (!name) return;
        analy.track(name, {
          ...attributeProps(form),
          values: formValues(form),
          completion: completion(countFields(form)),
          msInForm: state ? Date.now() - state.since : null,
        });
      };
      const reportAbandoned = () => {
        progress.forEach((state, form) => {
          if (state.fields.size) analy.track('form_abandon', summary(form, state, countFields(form)));
        });
        progress.clear();
      };
      const reportSnapshots = () => {
        progress.forEach((state, form) => {
          if (!state.fields.size || !state.changed) return;
          state.changed = false;
          const count = countFields(form);
          analy.track('form_snapshot', { ...summary(form, state, count), filled: count.filled, total: count.names.length });
        });
      };

      const listeners: Array<[string, (event: Event) => void]> = [
        ['input', onInput],
        ['change', onFinish],
        ['focusin', onFocusIn],
        ['focusout', onFocusOut],
        ['invalid', onInvalid],
        ['submit', onSubmit],
      ];
      for (const [type, listener] of listeners) document.addEventListener(type, listener, true);
      const offLeave = analy.on('leave', reportAbandoned);
      // A tab switch is not abandonment, but phones often unload a hidden tab without a pagehide,
      // so hiding snapshots what changed; only a real unload or a page change abandons.
      const offHide = analy.on('hide', ({ final }) => (final ? reportAbandoned() : reportSnapshots()));

      return () => {
        for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
        offLeave();
        offHide();
      };
    },
  };
}
