// npm run fuzz:all: one fuzz run per plugin subset (2^plugins), split over a few low-priority vitest
// processes so the machine stays usable. FUZZ_SHARDS=<n> sets how many (default 2; more is faster and
// hotter). It takes about an hour with the default.
import { spawn } from 'node:child_process';

const shards = Number(process.env.FUZZ_SHARDS ?? 2);
const started = Date.now();

const run = (shard) =>
  new Promise((resolve) => {
    let output = '';
    // nice 19: anything else the machine is doing goes first.
    const child = spawn('nice', ['-n', '19', 'npx', 'vitest', 'run', 'test/fuzz.test.ts'], {
      env: { ...process.env, FUZZ_EXHAUSTIVE: '1', FUZZ_SHARD: `${shard}/${shards}` },
    });
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => {
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'} shard ${shard}/${shards}`);
      resolve({ shard, code, output });
    });
  });

const results = await Promise.all(Array.from({ length: shards }, (_, shard) => run(shard)));
const failed = results.filter((r) => r.code !== 0);
for (const { shard, output } of failed) console.log(`\n--- shard ${shard} ---\n${output}`);
console.log(`${failed.length ? 'FAIL' : 'PASS'}: ${shards} shards in ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(failed.length ? 1 : 0);
