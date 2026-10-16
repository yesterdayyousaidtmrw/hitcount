import type { Json, Props } from '../../src/types';
import type { Rng } from './rng';

// Planted in URLs, titles, props, form fields and errors: with the redact plugin on, neither may
// appear anywhere in what is sent.
export const SECRET_EMAIL = 'secret.person@fuzz.test';
export const SECRET_TOKEN = 'SECRETTOKEN123';

const STRINGS = [
  '', 'hello', 'ünïcödé ✓ 🚀', 'a'.repeat(2000), SECRET_EMAIL, `see ?token=${SECRET_TOKEN}`,
  '<script>alert(1)</script>', 'line\nbreak', '"quoted"', '\u0000',
];
const NUMBERS = [0, -1, 3.14, 1e21, Number.MAX_SAFE_INTEGER];
const KEYS = ['plan', 'count', 'text', 'nested', 'list', 'flag', 'values', 'address', 'ip', 'gone'];

export function randomJson(rng: Rng, depth = 0): Json {
  switch (rng.int(0, depth > 2 ? 3 : 5)) {
    case 0:
      return rng.pick(STRINGS);
    case 1:
      return rng.pick(NUMBERS);
    case 2:
      return rng.chance(0.5);
    case 3:
      return null;
    case 4:
      return Array.from({ length: rng.int(0, 3) }, () => randomJson(rng, depth + 1));
    default:
      return Object.fromEntries(Array.from({ length: rng.int(0, 3) }, () => [rng.pick(KEYS), randomJson(rng, depth + 1)]));
  }
}

export function randomProps(rng: Rng): Props {
  const props: Props = {};
  for (let i = rng.int(0, 5); i > 0; i--) props[rng.pick(KEYS)] = randomJson(rng);
  if (rng.chance(0.2)) props.gone = undefined;
  return props;
}

export function randomUrl(rng: Rng): string {
  const path = rng.pick(['/', '/pricing', `/u/${SECRET_EMAIL}`, '/a/b/c', '/ünï']);
  const query = rng.pick([
    '', '?utm_source=chatgpt.com&utm_medium=referral', `?token=${SECRET_TOKEN}&q=shoes`, '?q=a+b',
    `?email=${encodeURIComponent(SECRET_EMAIL)}`,
  ]);
  const hash = rng.pick(['', '#top', `#access_token=${SECRET_TOKEN}`]);
  return path + query + hash;
}
