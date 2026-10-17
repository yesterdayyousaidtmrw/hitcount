import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { FunnelStepProps } from '../../src/events';
import { toRow } from '../../src/sinks/row';
import type { FuzzConfig } from './config';
import type { CustomCall, Outcome } from './session';
import { SECRET_EMAIL, SECRET_TOKEN } from './values';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateEvent = ajv.compile(JSON.parse(readFileSync('schema/event.v1.json', 'utf8')));
const validateRow = ajv.compile(JSON.parse(readFileSync('schema/row.v1.json', 'utf8')));

/** What must happen to a custom event, given consent when it was tracked and what came after. */
function fate(call: CustomCall, index: number, timeline: Outcome['timeline']): 'sent' | 'never' | 'maybe' {
  if (!call.live || call.consent === 'denied') return 'never';
  if (call.consent === 'granted') return 'sent';
  // Pending: held until the next decision. Held events are capped at 100, hence "maybe".
  const decision = timeline.find((change) => change.after > index && change.state !== 'pending');
  return decision?.state === 'granted' ? 'maybe' : 'never';
}

/** Every rule that must hold for every config and every visit. Returns what broke. */
export function checkInvariants(outcome: Outcome, config: FuzzConfig): string[] {
  const problems: string[] = [];
  const { sent } = outcome;

  if (outcome.thrown.length) problems.push(`hitcount threw into the page: ${outcome.thrown.map(String).join('; ')}`);
  const unexpected = outcome.errors.filter((e) => !e.source.startsWith('sink:fuzz-'));
  if (unexpected.length) problems.push(`onError: ${unexpected.map((e) => `${e.source}: ${String(e.error)}`).join('; ')}`);

  for (const event of sent) {
    const eventOk: boolean = validateEvent(event);
    if (!eventOk) problems.push(`${event.name} breaks schema/event.v1.json: ${ajv.errorsText(validateEvent.errors)}`);
    const rowOk: boolean = validateRow(toRow(event));
    if (!rowOk) problems.push(`${event.name} row breaks schema/row.v1.json: ${ajv.errorsText(validateRow.errors)}`);
  }
  const ids = new Set(sent.map((e) => e.id));
  if (ids.size !== sent.length) problems.push(`${sent.length - ids.size} duplicate event ids`);

  if (!outcome.enabled && sent.length) problems.push(`${sent.length} events sent despite a respected privacy signal`);

  const sentCount = new Map<string, number>();
  for (const event of sent) sentCount.set(event.name, (sentCount.get(event.name) ?? 0) + 1);
  outcome.custom.forEach((call, index) => {
    const count = sentCount.get(call.name) ?? 0;
    const dropped = config.beforeSend === 'drop' && call.name.endsWith('3');
    const expected = dropped ? 'never' : fate(call, index, outcome.timeline);
    if (count > 1) problems.push(`${call.name} sent ${count} times`);
    if (expected === 'never' && count) problems.push(`${call.name} sent though it should not be (consent ${call.consent}, dropped ${dropped})`);
    if (expected === 'sent' && !count) problems.push(`${call.name} tracked with consent granted but never sent`);
  });

  const everGranted = config.consent === 'granted' || outcome.timeline.some((c) => c.state === 'granted');
  const mayPersist = outcome.enabled && everGranted;
  const { local, session, cookies } = outcome.storage;
  if ((config.persist !== 'local' || !mayPersist) && local.length) problems.push(`localStorage written: ${local}`);
  if ((config.persist !== 'session' || !mayPersist) && session.length) problems.push(`sessionStorage written: ${session}`);
  if ((config.persist !== 'cookie' || !mayPersist) && cookies.includes('_hitcount')) problems.push(`cookie written: ${cookies}`);

  if (config.plugins.includes('redact')) {
    const text = JSON.stringify(sent);
    if (text.includes(SECRET_EMAIL) || text.includes(SECRET_TOKEN)) problems.push('redact let a planted email or token through');
    const personal = sent.filter(
      (e) =>
        ['values', 'address', 'ip'].some((key) => key in e.props) ||
        (e.name === 'form_progress' && 'value' in e.props) ||
        (e.name === 'form_error' && 'message' in e.props),
    );
    if (personal.length) problems.push(`redact kept personal props on ${personal.map((e) => e.name)}`);
    if (sent.some((e) => e.fingerprint)) problems.push('redact kept the device fingerprint');
  } else if (config.plugins.includes('fingerprint') && sent.length) {
    const fingerprints = new Set(sent.map((e) => e.fingerprint?.id));
    if (fingerprints.size !== 1 || fingerprints.has(undefined)) problems.push(`one visit, fingerprint ids: ${[...fingerprints]}`);
  }

  // Within a session, a funnel only moves forward until it is completed and can be entered again.
  const reached = new Map<string, number>();
  for (const event of sent.filter((e) => e.name === 'funnel_step')) {
    const { funnel, step, completed } = event.props as FunnelStepProps;
    const key = `${event.session} ${funnel}`;
    const before = reached.get(key) ?? 0;
    if (step <= before) problems.push(`funnel_step ${funnel} went from step ${before} to ${step} in one session`);
    reached.set(key, completed ? 0 : step);
  }

  if (outcome.sentAtDestroy >= 0 && sent.length !== outcome.sentAtDestroy) {
    problems.push(`${sent.length - outcome.sentAtDestroy} events sent after destroy()`);
  }
  return problems;
}
