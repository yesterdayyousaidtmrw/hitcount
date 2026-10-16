import { describe, expect, it } from 'vitest';
import { errors } from '../src/plugins/errors';
import { redact } from '../src/plugins/redact';
import { track } from './helpers';

function fail(message: string) {
  dispatchEvent(
    new ErrorEvent('error', { message, filename: 'https://a.test/app.js', lineno: 3, colno: 7, error: new Error(message) }),
  );
}

describe('errors', () => {
  it('reports each uncaught error once, message as-is', () => {
    const { sent } = track({ plugins: [errors()] });
    fail('No account for jane@example.com');
    fail('No account for jane@example.com');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: 'error',
      props: { kind: 'error', message: 'No account for jane@example.com', source: 'https://a.test/app.js', line: 3, column: 7 },
    });
  });

  it('hides emails in messages and stacks with the redact plugin', () => {
    const { sent } = track({ plugins: [errors(), redact()] });
    fail('No account for jane@example.com');
    expect(sent[0].props.message).toBe('No account for [email]');
    expect(JSON.stringify(sent)).not.toContain('jane@');
  });

  it('caps distinct errors per page load', () => {
    const { sent } = track({ plugins: [errors({ max: 2 })] });
    fail('a');
    fail('b');
    fail('c');
    expect(sent.map((e) => e.props.message)).toEqual(['a', 'b']);
  });

  it('reports unhandled promise rejections', () => {
    const { sent } = track({ plugins: [errors()] });
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', { value: new Error('request failed') });
    dispatchEvent(event);
    expect(sent[0]).toMatchObject({ name: 'error', props: { kind: 'unhandledrejection', message: 'request failed' } });
  });
});
