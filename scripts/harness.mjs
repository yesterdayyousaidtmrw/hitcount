// Harness: serves fixture sites (harness/sites) that load the built script, or only HTML pixels,
// receives their events on /collect and /pixel, validates every event against schema/event.v1.json
// and reports per fixture. Open http://localhost:4174/harness/ in any browser to run it.
//   --browser   run it headless in each of HARNESS_BROWSERS (comma list of chromium, firefox,
//               webkit; default chromium, which is the installed Chrome) and exit 0 when every
//               fixture passes in every one (npm run harness:ci)
//   --wait      exit 0 once every fixture passes, 1 after 60s (you open the page yourself)
//   --examples  save one real event per name to docs/examples.json (npm run docs turns them into
//               OpenAPI examples)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const PORT = Number(process.env.PORT ?? 4174);
const BROWSER = process.argv.includes('--browser');
const BROWSERS = (process.env.HARNESS_BROWSERS ?? 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const WAIT = process.argv.includes('--wait');
const SAVE_EXAMPLES = process.argv.includes('--examples');
const TIMEOUT_MS = 60_000;
const SERVED = ['harness/', 'dist/'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
// The collector must be reachable from sandboxed (origin "null") pages, as a real one would be.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
// Media fixtures play without a click, as a visitor's click would allow. WebKit has no switch for
// that, so its media fixtures pass only if WebKit lets muted media autoplay on its own.
const LAUNCH = {
  chromium: { channel: process.env.HARNESS_CHANNEL ?? 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0 } },
  webkit: {},
};

if (!existsSync('dist/analy.min.js') || !existsSync('dist/server.js')) {
  console.error('dist/ is missing: run npm run build first');
  process.exit(1);
}
const { eventFromPixel, PIXEL_GIF, PIXEL_HEADERS } = await import('../dist/server.js');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync('schema/event.v1.json', 'utf8')));
const fixtures = JSON.parse(readFileSync('harness/fixtures.json', 'utf8'));
const results = new Map();
const resetResults = () => fixtures.forEach((f) => results.set(f.name, { events: [], invalid: [] }));
resetResults();
const examples = {};

function record(fixture, event) {
  const result = results.get(fixture);
  if (!result) return `unknown fixture ${fixture}`;
  result.events.push(event.name);
  if (!validate(event)) {
    const errors = ajv.errorsText(validate.errors);
    result.invalid.push({ name: event.name, errors });
    return errors;
  }
  if (SAVE_EXAMPLES && !examples[event.name]) {
    examples[event.name] = event;
    const sorted = Object.fromEntries(Object.entries(examples).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync('docs/examples.json', `${JSON.stringify(sorted, null, 2)}\n`);
  }
  return '';
}

function passes({ name, expect }) {
  const { events, invalid } = results.get(name);
  const missing = [...expect];
  for (const event of events) {
    const at = missing.indexOf(event);
    if (at >= 0) missing.splice(at, 1);
  }
  return invalid.length === 0 && missing.length === 0;
}

const report = () => fixtures.map((f) => ({ ...f, ...results.get(f.name), pass: passes(f) }));

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function toRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    for (const item of [value].flat()) if (item !== undefined) headers.append(key, item);
  }
  return new Request(`http://localhost:${PORT}${req.url}`, { headers });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const fixture = url.searchParams.get('fixture') ?? '';

  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  // Fixture iframes are linked relative to /harness/, so the page must be served from there.
  if (url.pathname === '/' || url.pathname === '/harness') return res.writeHead(302, { location: '/harness/' }).end();
  if (req.method === 'POST' && url.pathname === '/collect') {
    let batch;
    try {
      batch = JSON.parse(await readBody(req));
    } catch (error) {
      console.log(`✗ ${fixture}: body is not JSON (${error.message})`);
      return res.writeHead(400, CORS).end();
    }
    const errors = batch.map((event) => record(fixture, event)).filter(Boolean);
    console.log(`${errors.length ? '✗' : '✓'} ${fixture}: ${batch.map((e) => e.name).join(', ')}${errors.length ? ` (${errors.join('; ')})` : ''}`);
    return res.writeHead(errors.length ? 400 : 204, CORS).end();
  }
  if (req.method === 'GET' && url.pathname === '/pixel') {
    const event = await eventFromPixel(toRequest(req), { salt: 'harness', ip: req.socket.remoteAddress ?? '' });
    const error = record(fixture, event);
    console.log(`${error ? '✗' : '✓'} ${fixture}: ${event.name} (pixel)${error ? ` ${error}` : ''}`);
    return res.writeHead(200, PIXEL_HEADERS).end(PIXEL_GIF);
  }
  if (req.method === 'GET' && url.pathname === '/results') {
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(report()));
  }

  const path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '');
  const file = path.endsWith('/') ? `${path}index.html` : path;
  if (!SERVED.some((dir) => file.startsWith(dir)) || !existsSync(file)) return res.writeHead(404).end('not found');
  return res
    .writeHead(200, { ...CORS, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    .end(readFileSync(file));
}

const server = createServer((req, res) =>
  handle(req, res).catch((error) => {
    console.error(error);
    res.writeHead(500).end();
  }),
);
await new Promise((resolve) => server.listen(PORT, resolve));
console.log(`harness: http://localhost:${PORT}/harness/`);

/** Resolves 0 once every fixture passes, 1 (after printing what is missing) on timeout. */
function untilDone(browser) {
  const label = browser ? ` ${browser}` : '';
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const status = report();
      const done = status.every((f) => f.pass);
      if (!done && Date.now() - started < TIMEOUT_MS) return;
      clearInterval(timer);
      if (done) console.log(`PASS${label}: all ${status.length} fixtures`);
      for (const f of status.filter((s) => !s.pass)) {
        console.log(`FAIL${label} ${f.name}: got [${f.events}] want [${f.expect}] invalid ${JSON.stringify(f.invalid)}`);
      }
      resolve(done ? 0 : 1);
    }, 500);
  });
}

// Iframes attach as about:blank and only then navigate, so poll their URLs rather than await attach.
async function waitForFrame(page, file) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().endsWith(`/${file}`));
    if (frame) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error(`fixture frame ${file} never loaded`);
}

/** Runs every fixture in one browser from fresh results. Resolves 0 when all pass, 1 otherwise. */
async function runIn(playwright, name) {
  const launch = LAUNCH[name];
  if (!launch) {
    console.log(`FAIL ${name}: unknown browser, use ${Object.keys(LAUNCH).join(', ')}`);
    return 1;
  }
  let browser;
  try {
    browser = await playwright[name].launch({ headless: true, ...launch });
  } catch (error) {
    const missing = /Executable doesn't exist|is not found at/.test(error.message);
    console.log(`FAIL ${name}: ${missing ? 'not installed, install it with' : error.message.split('\n')[0]}`);
    // playwright-core is the only Playwright here: its own CLI installs the exact revisions it drives,
    // where `npx playwright` would fetch whatever version npm has today.
    if (missing) console.log(`npx playwright-core install ${launch.channel ?? name}`);
    return 1;
  }
  try {
    resetResults();
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/harness/`);
    // Fixtures with "scroll": true have a lazy pixel a reader only reaches by scrolling.
    for (const { file } of fixtures.filter((f) => f.scroll)) {
      const frame = await waitForFrame(page, file);
      await frame.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
    return await untilDone(name);
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
    return 1;
  } finally {
    await browser.close();
  }
}

if (BROWSER) {
  // playwright-core drives browsers already on the machine; it never downloads one.
  const playwright = await import('playwright-core');
  let failed = 0;
  // One at a time: every browser reports into the same results, so each starts from fresh ones.
  for (const name of BROWSERS) failed += await runIn(playwright, name);
  process.exit(failed ? 1 : 0);
} else if (WAIT) {
  process.exit(await untilDone());
}
