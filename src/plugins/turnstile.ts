import type { TurnstileProps } from '../events';
import type { Plugin } from '../types';
import { describe } from '../core/dom';

export interface TurnstileOptions {
  /** Matches Turnstile's response-field-name option. Default cf-turnstile-response. */
  fieldName?: string;
}

interface Widget {
  shownAt: number;
  solved: boolean;
}

/**
 * Cloudflare Turnstile outcomes as `turnstile` events: shown, clicked (the visitor had to click,
 * i.e. an interactive challenge), solved (with ms since shown) and expired. Works for implicit and
 * explicit widgets by watching the hidden response field Turnstile fills in, so it needs
 * response-field left on. "solved" means a token was issued; only siteverify on your server
 * proves it is valid.
 */
export function turnstile({ fieldName = 'cf-turnstile-response' }: TurnstileOptions = {}): Plugin {
  return {
    name: 'turnstile',
    setup(analy) {
      const selector = `input[name="${fieldName}"]`;
      const widgets = new Map<HTMLInputElement, Widget>();

      // Turnstile renders <container><div><shadow-host/><input name=…></div></container>.
      const report = (input: HTMLInputElement, status: TurnstileProps['status'], extra: Pick<TurnstileProps, 'ms'> = {}) =>
        analy.track('turnstile', { status, widget: describe(input.parentElement?.parentElement ?? input), ...extra });

      const check = (input: HTMLInputElement) => {
        let widget = widgets.get(input);
        if (!widget) {
          widget = { shownAt: Date.now(), solved: false };
          widgets.set(input, widget);
          report(input, 'shown');
        }
        const solved = input.value !== '';
        if (solved && !widget.solved) report(input, 'solved', { ms: Date.now() - widget.shownAt });
        if (!solved && widget.solved) report(input, 'expired');
        widget.solved = solved;
      };
      const scan = () => document.querySelectorAll<HTMLInputElement>(selector).forEach(check);

      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'attributes' && record.target instanceof HTMLInputElement && record.target.matches(selector)) {
            check(record.target);
          }
          for (const node of Array.from(record.addedNodes)) {
            if (node instanceof Element && (node.matches(selector) || node.querySelector(selector))) scan();
          }
        }
      });
      // Clicking into the widget's iframe blurs the window and focuses the widget's shadow host.
      const onBlur = () => {
        const active = document.activeElement;
        widgets.forEach((_, input) => {
          if (active && input.parentElement?.contains(active)) report(input, 'clicked');
        });
      };

      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['value'] });
      addEventListener('blur', onBlur);
      scan();
      return () => {
        observer.disconnect();
        removeEventListener('blur', onBlur);
      };
    },
  };
}
