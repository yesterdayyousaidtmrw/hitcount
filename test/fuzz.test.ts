// Fuzzer: random configs x random visits, checked against the invariants in test/fuzz/invariants.ts.
//   npm test          200 runs from a fixed seed (fast, deterministic)
//   npm run fuzz      3000 runs from a random seed
//   npm run fuzz:all  one run for every combination of the plugins (2^plugins), split across cores
// A failure prints the seed and config; FUZZ_SEED=<seed> FUZZ_RUNS=1 replays exactly that run.
import { describe, expect, it } from 'vitest';
import { PLUGIN_SUBSETS, randomConfig } from './fuzz/config';
import { checkInvariants } from './fuzz/invariants';
import { createRng } from './fuzz/rng';
import { runSession } from './fuzz/session';
import { resetDom } from './helpers';

const EXHAUSTIVE = process.env.FUZZ_EXHAUSTIVE === '1';
const RUNS = EXHAUSTIVE ? PLUGIN_SUBSETS : Number(process.env.FUZZ_RUNS ?? 200);
const SEED = process.env.FUZZ_SEED === 'random' ? Math.floor(Math.random() * 2 ** 31) : Number(process.env.FUZZ_SEED ?? 1);
const MAX_REPORTED = 5;
// FUZZ_SHARD=i/n runs every n-th run starting at i, so fuzz:all can spread 2^plugins runs over cores.
const [SHARD, SHARDS] = (process.env.FUZZ_SHARD ?? '0/1').split('/').map(Number);

describe('fuzz', () => {
  it(`${RUNS} random visits keep every invariant (seed ${SEED}${EXHAUSTIVE ? ', every plugin subset' : ''}, shard ${SHARD}/${SHARDS})`, async () => {
    const failures: Array<{ seed: number; config: unknown; problems: string[] }> = [];
    for (let run = SHARD; run < RUNS && failures.length < MAX_REPORTED; run += SHARDS) {
      const seed = SEED + run;
      const rng = createRng(seed);
      const config = EXHAUSTIVE ? randomConfig(rng, run) : randomConfig(rng);
      const problems = checkInvariants(await runSession(rng, config), config);
      if (problems.length) failures.push({ seed, config, problems });
      resetDom();
    }
    expect(failures, `replay one with FUZZ_SEED=<seed> FUZZ_RUNS=1 npx vitest run test/fuzz.test.ts`).toEqual([]);
  }, 3 * 60 * 60_000);
});
