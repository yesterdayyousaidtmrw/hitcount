import type { Plugin, Traffic, TrafficKind } from '../types';

export interface TrafficOptions {
  /** Drop events from these kinds instead of tagging them, e.g. ['crawler', 'automated']. */
  drop?: TrafficKind[];
}

// UA tokens AI companies publish for their crawlers and user-triggered fetchers.
const AI_UA =
  /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Bytespider|CCBot|Amazonbot|meta-externalagent|meta-externalfetcher|MistralAI-User|DuckAssistBot|cohere-ai|Diffbot|AI2Bot|YouBot/i;
const CRAWLER_UA = /bot\b|crawl|spider|slurp|facebookexternalhit|embedly|lighthouse|pingdom|uptime/i;
const HEADLESS_UA = /HeadlessChrome|PhantomJS/i;
const AUTOMATION_GLOBALS = ['callPhantom', '_phantom', '__nightmare', 'domAutomation', 'domAutomationController'];
// A real mouse emits dozens of moves within seconds; this many trusted moves counts as a human.
const HUMAN_MOVES = 20;
const LISTEN = { capture: true, passive: true };
// Within 3% of the centre on both axes, 3 clicks in a row: ~1 in 60,000 for a person whose clicks
// spread ±15% around the centre. The in-app browser's agent clicks all landed within 1%.
const CENTER_TOLERANCE = 0.03;
const CENTERED_RUN = 3;
const MIN_TARGET_PX = 12;

function userAgentSignals(ua: string): string[] {
  const signals: string[] = [];
  if (AI_UA.test(ua)) signals.push('ai-user-agent');
  else if (CRAWLER_UA.test(ua)) signals.push('crawler-user-agent');
  if (HEADLESS_UA.test(ua)) signals.push('headless-user-agent');
  return signals;
}

function browserSignals(): string[] {
  const signals: string[] = [];
  if (navigator.webdriver) signals.push('webdriver');
  if (!navigator.languages?.length) signals.push('no-languages');
  if (AUTOMATION_GLOBALS.some((key) => key in window)) signals.push('automation-globals');
  return signals;
}

function kindOf(signals: string[], human: boolean): TrafficKind {
  if (signals.includes('ai-user-agent')) return 'ai-agent';
  if (signals.includes('crawler-user-agent')) return 'crawler';
  if (signals.length) return 'automated';
  return human ? 'human' : 'unknown';
}

/** The verdict a user-agent string alone supports. Used server-side for HTML-only (pixel) hits. */
export function classifyUserAgent(ua: string): Traffic {
  const signals = userAgentSignals(ua);
  return { kind: kindOf(signals, false), signals };
}

/**
 * Tags every event with traffic.kind: human, crawler, ai-agent, automated (webdriver, headless,
 * agent-style clicks) or unknown (no evidence yet). Each event carries the verdict at that moment.
 */
export function traffic({ drop = [] }: TrafficOptions = {}): Plugin {
  const signals = new Set<string>();
  let moves = 0;
  let pointerType = 'mouse';
  let centeredRun = 0;

  const kind = (): TrafficKind => kindOf([...signals], moves >= HUMAN_MOVES);

  return {
    name: 'traffic',
    setup() {
      [...userAgentSignals(navigator.userAgent), ...browserSignals()].forEach((s) => signals.add(s));
      const finePointer = matchMedia('(pointer: fine)').matches;

      const onMove = (event: PointerEvent) => {
        if (event.isTrusted) moves++;
      };
      const onDown = (event: PointerEvent) => {
        pointerType = event.pointerType;
      };
      const onTouch = (event: TouchEvent) => {
        if (event.isTrusted) moves = Math.max(moves, HUMAN_MOVES);
      };
      // detail 0 is a keyboard activation: no pointer position to judge.
      const onClick = (event: MouseEvent) => {
        if (!event.isTrusted || event.detail === 0) return;
        // Browser agents driven over CDP click at coordinates without moving the mouse there first.
        // Touch/pen taps never move a mouse, so only mouse clicks count.
        if (finePointer && pointerType === 'mouse' && moves < 2) signals.add('click-without-mouse-movement');
        // Agents aim at the exact centre of their target; people land all over it.
        const target = event.target instanceof Element ? event.target : null;
        const box = target?.getBoundingClientRect();
        if (!box || box.width < MIN_TARGET_PX || box.height < MIN_TARGET_PX) return;
        const offX = Math.abs((event.clientX - box.left) / box.width - 0.5);
        const offY = Math.abs((event.clientY - box.top) / box.height - 0.5);
        centeredRun = offX < CENTER_TOLERANCE && offY < CENTER_TOLERANCE ? centeredRun + 1 : 0;
        if (centeredRun >= CENTERED_RUN) signals.add('centered-clicks');
      };

      addEventListener('pointermove', onMove, LISTEN);
      addEventListener('pointerdown', onDown, LISTEN);
      addEventListener('touchstart', onTouch, LISTEN);
      addEventListener('click', onClick, LISTEN);
      return () => {
        removeEventListener('pointermove', onMove, LISTEN);
        removeEventListener('pointerdown', onDown, LISTEN);
        removeEventListener('touchstart', onTouch, LISTEN);
        removeEventListener('click', onClick, LISTEN);
      };
    },
    enrich(event) {
      const traffic = { kind: kind(), signals: [...signals] };
      if (drop.includes(traffic.kind)) return null;
      event.traffic = traffic;
      return event;
    },
  };
}
