// npm run fuzz:all: one fuzz run per plugin subset (2^plugins), split into one vitest process per core.
//   FUZZ_SHARDS=<n> sets the number of processes (default: cores - 1).
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

const shards = Number(process.env.FUZZ_SHARDS ?? Math.max(1, availableParallelism() - 1));
const started = Date.now();

const run = (shard) =>
  new Promise((resolve) => {
    let output = '';
    const child = spawn('npx', ['vitest', 'run', 'test/fuzz.test.ts'], {
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
