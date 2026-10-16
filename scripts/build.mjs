import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

// Gzipped byte budgets. The build fails when a bundle grows past its budget.
const BUDGETS = {
  'dist/analy.min.js': 6_900,
  'dist/analy.full.min.js': 9_700,
  'core + pageviews + http (npm)': 3_400,
};

rmSync('dist', { recursive: true, force: true });

const shared = { bundle: true, target: 'es2020', logLevel: 'warning' };
const script = { ...shared, format: 'iife', minify: true, legalComments: 'none' };
await Promise.all([
  build({ ...script, entryPoints: ['src/script/lite.ts'], outfile: 'dist/analy.min.js' }),
  build({ ...script, entryPoints: ['src/script/full.ts'], outfile: 'dist/analy.full.min.js' }),
  build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.js', format: 'esm' }),
  build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.cjs', format: 'cjs' }),
  build({ ...shared, entryPoints: ['src/server.ts'], outfile: 'dist/server.js', format: 'esm', platform: 'neutral' }),
]);
execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });

// What an npm user pays for the smallest useful setup, after tree-shaking.
const core = await build({
  ...shared,
  stdin: {
    contents: "import { createAnaly, http, pageviews } from './src/index.ts'; createAnaly({ sinks: [http('/e')], plugins: [pageviews()] });",
    resolveDir: '.',
    loader: 'ts',
  },
  format: 'esm',
  minify: true,
  write: false,
});

const sizes = {
  'dist/analy.min.js': readFileSync('dist/analy.min.js'),
  'dist/analy.full.min.js': readFileSync('dist/analy.full.min.js'),
  'core + pageviews + http (npm)': core.outputFiles[0].contents,
};
let over = false;
for (const [name, bytes] of Object.entries(sizes)) {
  const gzipped = gzipSync(bytes, { level: 9 }).length;
  const budget = BUDGETS[name];
  over ||= gzipped > budget;
  console.log(`${gzipped > budget ? 'OVER' : 'ok  '} ${name}: ${gzipped} B gzipped (budget ${budget})`);
}
if (over) process.exit(1);
