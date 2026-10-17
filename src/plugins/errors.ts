import type { ErrorProps } from '../events';
import type { Plugin } from '../types';

export interface ErrorsOptions {
  /** Distinct errors reported per page load. Default 10. */
  max?: number;
}

/** Uncaught errors and unhandled promise rejections, deduplicated and capped. */
export function errors({ max = 10 }: ErrorsOptions = {}): Plugin {
  return {
    name: 'errors',
    setup(hitcount) {
      const seen = new Set<string>();
      const stackOf = (value: unknown) => (value instanceof Error && value.stack ? value.stack.slice(0, 1000) : null);

      const report = (message: string, details: Omit<ErrorProps, 'message'>) => {
        const key = `${message}|${details.source ?? ''}|${details.line ?? ''}`;
        if (seen.has(key) || seen.size >= max) return;
        seen.add(key);
        hitcount.track('error', { message: message.slice(0, 500), ...details });
      };
      const onError = (event: ErrorEvent) =>
        report(event.message || 'Unknown error', {
          kind: 'error',
          source: event.filename || null,
          line: event.lineno || null,
          column: event.colno || null,
          stack: stackOf(event.error),
        });
      const onRejection = (event: PromiseRejectionEvent) =>
        report(event.reason instanceof Error ? event.reason.message : String(event.reason), {
          kind: 'unhandledrejection',
          stack: stackOf(event.reason),
        });

      addEventListener('error', onError);
      addEventListener('unhandledrejection', onRejection);
      return () => {
        removeEventListener('error', onError);
        removeEventListener('unhandledrejection', onRejection);
      };
    },
  };
}
