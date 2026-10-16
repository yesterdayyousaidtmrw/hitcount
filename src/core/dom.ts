import type { Props } from '../types';

export const ATTRIBUTE = 'data-analy';

// A composed event from inside an open shadow root (a web component) reaches document listeners
// retargeted to the host, so event.target and target.closest() never see inside it. composedPath()
// still lists the elements inside, innermost first. Browsers without it have no shadow DOM either.

/** The element the event started on, inside any open shadow root. */
export function targetElement(event: Event): Element | null {
  const origin = event.composedPath?.()[0] ?? event.target;
  return origin instanceof Element ? origin : null;
}

/** target.closest(selector), across open shadow roots. */
export function closestInPath<E extends Element = Element>(event: Event, selector: string): E | null {
  if (!event.composedPath) return targetElement(event)?.closest<E>(selector) ?? null;
  for (const node of event.composedPath()) {
    if (node instanceof Element && node.matches(selector)) return node as E;
  }
  return null;
}

/** data-analy-plan="pro" → { plan: "pro" } */
export function attributeProps(el: Element): Props {
  const props: Props = {};
  const prefix = `${ATTRIBUTE}-`;
  for (const { name, value } of Array.from(el.attributes)) {
    if (name.startsWith(prefix)) props[name.slice(prefix.length)] = value;
  }
  return props;
}

/** tag#id.class1.class2 — getAttribute because a form's .id can be shadowed by an input named "id". */
export function describe(el: Element): string {
  const id = el.getAttribute('id');
  const classes = Array.from(el.classList, (c) => `.${c}`).slice(0, 2).join('');
  return `${el.tagName.toLowerCase()}${id ? `#${id}` : ''}${classes}`;
}
