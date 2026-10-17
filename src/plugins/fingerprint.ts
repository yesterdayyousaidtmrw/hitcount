import type { Fingerprint, FingerprintReason, Plugin } from '../types';

// Families an OS ships, not ones sites serve as web fonts: a web font that has loaded by the second page
// would count as installed there and not on the first, and change the id between them.
const FONTS = [
  'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
  'Franklin Gothic Medium', 'Gabriola', 'Impact', 'Lucida Console', 'Palatino Linotype', 'Segoe UI', 'Tahoma',
  'Trebuchet MS', 'Verdana', // Windows
  'American Typewriter', 'Avenir', 'Futura', 'Geneva', 'Gill Sans', 'Helvetica Neue', 'Menlo', 'Monaco', 'Optima', // Apple
  'Cantarell', 'DejaVu Sans', 'Liberation Sans', // Linux
];
// A family that is not installed falls back to the generic and measures the same as it. One that is
// the generic's own default only differs from the other two, hence three.
const GENERICS = ['monospace', 'sans-serif', 'serif'];
const SAMPLE = 'mmmmmmmmmmlli';

// Firefox's resistFingerprinting (Tor and Mullvad Browser too) reports UTC, which some versions name
// Atlantic/Reykjavik, and the window as the screen. Either alone is common: a UTC server, a fullscreen
// window. Both with a Firefox user agent is the setting; Chrome on a UTC server is headless, not this.
const SPOOFED_TIMEZONES = ['UTC', 'Etc/UTC', 'Atlantic/Reykjavik'];

// The reasons that make the id vary between visits. A missing canvas or WebGL leaves it stable, only
// less unique, so it does not count.
const SCRAMBLING: FingerprintReason[] = ['canvas-noise', 'brave', 'resist-fingerprinting'];

// One probe per API: a browser or extension that blocks one must not cost the others or throw into
// the page. undefined is "unavailable", which the caller turns into a reason.
function attempt<T>(probe: () => T): T | undefined {
  try {
    return probe();
  } catch {
    return undefined;
  }
}

// Text with an emoji and blended shapes: anti-aliasing, emoji fonts and blending differ between
// systems, GPUs and drivers, so the pixels do too.
function drawCanvas(): string | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 60;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f60';
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069';
  ctx.font = '11pt Arial';
  ctx.fillText('Sphinx of black quartz, judge my vow \u{1F603}', 2, 15);
  ctx.globalCompositeOperation = 'multiply';
  for (const [color, x] of [['#f2f', 40], ['#2ff', 80], ['#ff2', 60]] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, 40, 20, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toDataURL();
}

function webglRenderer(): string | undefined {
  const gl = document.createElement('canvas').getContext('webgl');
  if (!gl) return undefined;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
  const renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  // A page gets a handful of live WebGL contexts; give this one back.
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return `${vendor}|${renderer}`;
}

function installedFonts(): string[] | undefined {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return undefined;
  const width = (font: string) => {
    ctx.font = `72px ${font}`;
    return ctx.measureText(SAMPLE).width;
  };
  const fallbacks = GENERICS.map(width);
  return FONTS.filter((family) => GENERICS.some((generic, i) => width(`"${family}", ${generic}`) !== fallbacks[i]));
}

function hardware(): unknown[] {
  return [
    // Largest side first, so turning a phone round does not change it.
    [screen.width, screen.height].sort((a, b) => b - a),
    screen.colorDepth,
    devicePixelRatio,
    navigator.hardwareConcurrency,
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    navigator.languages,
    navigator.platform,
    navigator.maxTouchPoints,
  ];
}

function resistsFingerprinting(timezone: string | undefined): boolean {
  return (
    /Firefox\//.test(navigator.userAgent) &&
    SPOOFED_TIMEZONES.includes(timezone ?? '') &&
    screen.width === innerWidth &&
    screen.height === innerHeight
  );
}

/**
 * cyrb128: a fast non-cryptographic 128-bit hash, as 32 hex characters. Not crypto.subtle, which plain
 * http pages do not have, and which is async where enrich is not.
 */
function hash128(text: string): string {
  let a = 1779033703;
  let b = 3144134277;
  let c = 1013904242;
  let d = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    a = b ^ Math.imul(a ^ k, 597399067);
    b = c ^ Math.imul(b ^ k, 2869860233);
    c = d ^ Math.imul(c ^ k, 951274213);
    d = a ^ Math.imul(d ^ k, 2716044179);
  }
  a = Math.imul(c ^ (a >>> 18), 597399067);
  b = Math.imul(d ^ (b >>> 22), 2869860233);
  c = Math.imul(a ^ (c >>> 17), 951274213);
  d = Math.imul(b ^ (d >>> 19), 2716044179);
  a ^= b ^ c ^ d;
  b ^= a;
  c ^= a;
  d ^= a;
  return [a, b, c, d].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

function readFingerprint(): Fingerprint {
  const reasons: FingerprintReason[] = [];
  const canvas = attempt(drawCanvas);
  // Noise injected on read-back changes every read; the same drawing twice gives it away.
  const noisy = canvas !== undefined && canvas !== attempt(drawCanvas);
  if (canvas === undefined) reasons.push('canvas-unavailable');
  if (noisy) reasons.push('canvas-noise');
  const webgl = attempt(webglRenderer);
  if (webgl === undefined) reasons.push('webgl-unavailable');
  if ('brave' in navigator) reasons.push('brave');
  const timezone = attempt(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (attempt(() => resistsFingerprinting(timezone))) reasons.push('resist-fingerprinting');

  const signals = [noisy ? undefined : canvas, webgl, attempt(installedFonts), timezone, attempt(hardware)];
  return {
    id: hash128(JSON.stringify(signals)),
    scrambled: reasons.some((reason) => SCRAMBLING.includes(reason)),
    reasons,
  };
}

// hitcount.store key: the fingerprint read for the current session.
const SAVED = 'fingerprint';

function savedFor(saved: string | undefined, session: string): Fingerprint | undefined {
  try {
    const parsed = saved ? (JSON.parse(saved) as { session?: string; fingerprint?: Fingerprint }) : undefined;
    return parsed?.session === session ? parsed.fingerprint : undefined;
  } catch {
    // Unreadable: read the device again.
    return undefined;
  }
}

/**
 * Adds fingerprint { id, scrambled, reasons } to every event: a hash of the canvas, WebGL, fonts,
 * screen, hardware, timezone and languages, which stays the same when storage is cleared. Read once,
 * on the first event sent, so never before consent. In the EU and UK reading the device needs the
 * visitor's consent: start with consent: 'pending' there.
 */
export function fingerprint(): Plugin {
  let computed: Fingerprint | undefined;
  return {
    name: 'fingerprint',
    // enrich, not setup: the tracker only enriches once consent is granted.
    enrich(event, hitcount) {
      if (!computed) {
        // Reading takes tens of ms (GPU start-up, font checks), so only a session's first page pays.
        computed = savedFor(hitcount.store.get(SAVED), event.session);
        if (!computed) {
          computed = readFingerprint();
          hitcount.store.set(SAVED, JSON.stringify({ session: event.session, fingerprint: computed }));
        }
      }
      event.fingerprint = { ...computed, reasons: [...computed.reasons] };
      return event;
    },
  };
}
