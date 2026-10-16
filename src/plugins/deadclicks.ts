import type { Plugin } from '../types';
import { ATTRIBUTE, describe, targetElement } from '../core/dom';

export interface DeadClickOptions {
  /** How long the page has to react before the click counts as dead. Default 1000. */
  waitMs?: number;
}

// <select> is left out: its picker opens outside the DOM, so a choice made after waitMs would look dead.
const ACTIONABLE = [
  'a[href]', 'button', 'summary', 'label',
  'input[type=button]', 'input[type=submit]', 'input[type=reset]', 'input[type=checkbox]', 'input[type=radio]',
  '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[onclick]', `[${ATTRIBUTE}]`,
].join(',');
// Any of these during the wait means the click did something. input/change: a checkbox or radio
// toggled, which changes a property and so no mutation; submit/reset: the browser took over the form.
const REACTIONS = ['scroll', 'focusin', 'input', 'change', 'submit', 'reset'];
const LISTEN = { capture: true, passive: true };
const MUTATIONS = { childList: true, attributes: true, characterData: true, subtree: true };

/** The browser is following the link: a slow page load, a download or a mail app shows nothing here in time. */
function followedLink(el: Element, click: MouseEvent): boolean {
  const href = el.closest('a[href]')?.getAttribute('href');
  return href != null && !click.defaultPrevented && !/^\s*javascript:/i.test(href);
}

/**
 * A click on something that looks actionable where nothing happened within `waitMs`: no DOM change,
 * URL change, scroll, focus move, form input, page hide or new page view. Sends `dead_click`.
 */
export function deadclicks({ waitMs = 1000 }: DeadClickOptions = {}): Plugin {
  return {
    name: 'deadclicks',
    setup(analy) {
      const pending = new Map<Element, ReturnType<typeof setTimeout>>();

      // Everything below only listens while a check is pending: watching every mutation all the time
      // would cost the page for nothing.
      const mutations = new MutationObserver(() => settle());
      // A focusin always means focus moved elsewhere: the clicked element took focus on mousedown,
      // before the click that started the check.
      const onReaction = () => settle();
      const watch = () => {
        mutations.observe(document.documentElement, MUTATIONS);
        REACTIONS.forEach((type) => addEventListener(type, onReaction, LISTEN));
      };
      const unwatch = () => {
        mutations.disconnect();
        REACTIONS.forEach((type) => removeEventListener(type, onReaction, LISTEN));
      };
      const settle = () => {
        pending.forEach((timer) => clearTimeout(timer));
        pending.clear();
        unwatch();
      };

      const expire = (el: Element, click: MouseEvent, url: string) => {
        pending.delete(el);
        if (!pending.size) unwatch();
        if (location.href !== url || followedLink(el, click)) return;
        analy.track('dead_click', { element: describe(el), disabled: el.matches(':disabled, [aria-disabled=true]') });
      };
      const onClick = (event: MouseEvent) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const el = targetElement(event)?.closest(ACTIONABLE);
        if (!el || pending.has(el)) return;
        if (!pending.size) watch();
        const url = location.href;
        pending.set(el, setTimeout(() => expire(el, event, url), waitMs));
      };

      document.addEventListener('click', onClick, true);
      const offHide = analy.on('hide', settle);
      const offLeave = analy.on('leave', settle);
      return () => {
        settle();
        document.removeEventListener('click', onClick, true);
        offHide();
        offLeave();
      };
    },
  };
}
