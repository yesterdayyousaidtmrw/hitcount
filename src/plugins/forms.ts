import type { Plugin } from '../types';
import { ATTRIBUTE, attributeProps, closestInPath, describe, targetElement } from '../core/dom';

interface Progress {
  fields: Set<string>;
  lastField: string;
}

/** Named fields as the browser would submit them; files reduce to their file name. */
function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  new FormData(form).forEach((value, key) => {
    values[key] = typeof value === 'string' ? value : value.name;
  });
  return values;
}

/**
 * The form an input event belongs to, across open shadow roots, and the field as that form sees
 * it: for a design-system input inside a light-DOM form that is the component's host, which
 * carries the name, not the input inside it.
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
 * <form data-analy="signup"> sends `signup` on submit. Any form a visitor started filling but
 * left without submitting sends `form_abandon`. Both carry the field values (the redact plugin
 * removes them). Add data-analy-ignore to a form to skip it.
 */
export function forms(): Plugin {
  return {
    name: 'forms',
    setup(analy) {
      const started = new Map<HTMLFormElement, Progress>();
      // submit is not composed: from a form inside a shadow root it never reaches the document, so
      // such a form gets its own listener once a visitor types in it. Teardown cannot find those
      // listeners again; they stay, like the history wrap in pageviews, and a destroyed tracker
      // sends nothing.
      const shadowForms = new WeakSet<HTMLFormElement>();

      const formName = (form: HTMLFormElement) =>
        form.getAttribute(ATTRIBUTE) || form.getAttribute('id') || form.getAttribute('name') || describe(form);

      const onInput = (event: Event) => {
        const [field, form] = fieldAndForm(event) ?? [];
        if (!field || !form || form.hasAttribute(`${ATTRIBUTE}-ignore`)) return;
        if (form.getRootNode() instanceof ShadowRoot && !shadowForms.has(form)) {
          shadowForms.add(form);
          form.addEventListener('submit', onSubmit);
        }
        const key = field.getAttribute('name') || field.getAttribute('id') || field.tagName.toLowerCase();
        const progress = started.get(form) ?? { fields: new Set<string>(), lastField: key };
        progress.fields.add(key);
        progress.lastField = key;
        started.set(form, progress);
      };
      const onSubmit = (event: Event) => {
        const form = targetElement(event);
        if (!(form instanceof HTMLFormElement)) return;
        started.delete(form);
        const name = form.getAttribute(ATTRIBUTE);
        if (name) analy.track(name, { ...attributeProps(form), values: formValues(form) });
      };
      const reportAbandoned = () => {
        started.forEach(({ fields, lastField }, form) =>
          analy.track('form_abandon', {
            form: formName(form),
            fieldsTouched: fields.size,
            lastField,
            values: formValues(form),
          }),
        );
        started.clear();
      };

      document.addEventListener('input', onInput, true);
      document.addEventListener('submit', onSubmit, true);
      const offLeave = analy.on('leave', reportAbandoned);
      // Only a real unload counts: a tab switch is not abandonment.
      const offHide = analy.on('hide', ({ final }) => {
        if (final) reportAbandoned();
      });

      return () => {
        document.removeEventListener('input', onInput, true);
        document.removeEventListener('submit', onSubmit, true);
        offLeave();
        offHide();
      };
    },
  };
}
