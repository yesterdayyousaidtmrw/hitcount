import type { Props } from '../types';

export const ATTRIBUTE = 'data-analy';

export function targetElement(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
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
