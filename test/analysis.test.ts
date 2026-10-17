// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { type EventRow, toRow } from '../src/sinks/row';
import type { Props } from '../src/types';
import { sampleEvent } from './helpers';

// schema/analysis.sql on a real Postgres, over a small hand-made dataset whose answers are worked out
// by hand below. Two sites: shop (sessions 1–3) and blog (sessions 4–5), all on 2026-10-16.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 16, 12, minute)).toISOString();
const step = (number: number, stepName: string): Props => ({ funnel: 'signup', step: number, stepName, steps: 3 });

let count = 0;
function row(site: string, session: number, minute: number, name: string, path: string, props: Props = {}): EventRow {
  count++;
  return toRow(
    sampleEvent({
      id: uuid(count),
      name,
      time: at(minute),
      site,
      session: uuid(1000 + session),
      page: { url: `https://${site}.test${path}`, path, title: '', viewId: uuid(2000 + count) },
      props,
    }),
  );
}

const ROWS: EventRow[] = [
  // Session 1: / → /pricing → /signup → signed up → back to /pricing, which enters the funnel again.
  row('shop', 1, 0, 'pageview', '/'),
  row('shop', 1, 1, 'pageview', '/pricing'),
  row('shop', 1, 1, 'funnel_step', '/pricing', step(1, '/pricing')),
  row('shop', 1, 2, 'pageview', '/signup'),
  row('shop', 1, 2, 'funnel_step', '/signup', step(2, '/signup')),
  row('shop', 1, 3, 'signup_completed', '/signup'),
  row('shop', 1, 3, 'funnel_step', '/signup', step(3, 'signup_completed')),
  row('shop', 1, 4, 'pageview', '/pricing'),
  row('shop', 1, 4, 'funnel_step', '/pricing', step(1, '/pricing')),
  // Session 2, after the funnel was redeclared with /plans as step 1: skips /signup.
  row('shop', 2, 10, 'pageview', '/plans'),
  row('shop', 2, 10, 'funnel_step', '/plans', step(1, '/plans')),
  row('shop', 2, 11, 'pageview', '/docs'),
  row('shop', 2, 12, 'signup_completed', '/docs'),
  row('shop', 2, 12, 'funnel_step', '/docs', step(3, 'signup_completed')),
  // Session 3: back and forth between / and /docs, no funnel.
  row('shop', 3, 20, 'pageview', '/'),
  row('shop', 3, 21, 'pageview', '/docs'),
  row('shop', 3, 22, 'pageview', '/'),
  row('shop', 3, 23, 'pageview', '/docs'),
  // Junk anyone holding the public key could insert: hitcount_funnels must neither fail nor count it.
  row('shop', 3, 24, 'funnel_step', '/docs', { funnel: 'signup', step: 'two', stepName: '/x', steps: 3 }),
  row('shop', 3, 24, 'funnel_step', '/docs', { funnel: 'huge', step: 1, stepName: '/x', steps: 100_000_000 }),
  row('shop', 3, 24, 'funnel_step', '/docs', { step: 1, stepName: '/x', steps: 3 }),
  // Session 4 on the other site: the same funnel name, step 1 only.
  row('blog', 4, 30, 'pageview', '/'),
  row('blog', 4, 31, 'pageview', '/pricing'),
  row('blog', 4, 31, 'funnel_step', '/pricing', step(1, '/pricing')),
  // Session 5: one page.
  row('blog', 5, 32, 'pageview', '/post'),
];

let db: PGlite;
const select = async (sql: string) => (await db.query(sql)).rows;

beforeAll(async () => {
  db = await PGlite.create();
  // postgres.sql ends with Supabase's row-level security for the anon role, which plain Postgres lacks.
  await db.exec('create role anon');
  await db.exec(readFileSync('schema/postgres.sql', 'utf8'));
  await db.exec(readFileSync('schema/analysis.sql', 'utf8'));
  // Newest first, so nothing below can lean on insertion order.
  for (const event of [...ROWS].reverse()) {
    const columns = Object.keys(event);
    const params = columns.map((_, i) => `$${i + 1}`);
    await db.query(`insert into hitcount_events (${columns.join(', ')}) values (${params.join(', ')})`, Object.values(event));
  }
});

describe('schema/analysis.sql', () => {
  it('hitcount_funnels: sessions per step out of those that entered, and how many stopped at the step before', async () => {
    expect(await select('select * from hitcount_funnels order by site, funnel, step')).toEqual([
      { site: 'blog', funnel: 'signup', step: 1, step_name: '/pricing', sessions: 1, entered: 1, pct_of_entered: '100.0', drop_from_previous: null },
      { site: 'blog', funnel: 'signup', step: 2, step_name: null, sessions: 0, entered: 1, pct_of_entered: '0.0', drop_from_previous: 1 },
      { site: 'blog', funnel: 'signup', step: 3, step_name: null, sessions: 0, entered: 1, pct_of_entered: '0.0', drop_from_previous: 0 },
      { site: 'shop', funnel: 'signup', step: 1, step_name: '/plans', sessions: 2, entered: 2, pct_of_entered: '100.0', drop_from_previous: null },
      { site: 'shop', funnel: 'signup', step: 2, step_name: '/signup', sessions: 1, entered: 2, pct_of_entered: '50.0', drop_from_previous: 1 },
      { site: 'shop', funnel: 'signup', step: 3, step_name: 'signup_completed', sessions: 2, entered: 2, pct_of_entered: '100.0', drop_from_previous: 0 },
    ]);
  });

  it('hitcount_flows: page view to next page view within a session', async () => {
    expect(await select('select * from hitcount_flows order by site, from_path, to_path')).toEqual([
      { site: 'blog', from_path: '/', to_path: '/pricing', transitions: 1, sessions: 1 },
      { site: 'shop', from_path: '/', to_path: '/docs', transitions: 2, sessions: 1 },
      { site: 'shop', from_path: '/', to_path: '/pricing', transitions: 1, sessions: 1 },
      { site: 'shop', from_path: '/docs', to_path: '/', transitions: 1, sessions: 1 },
      { site: 'shop', from_path: '/plans', to_path: '/docs', transitions: 1, sessions: 1 },
      { site: 'shop', from_path: '/pricing', to_path: '/signup', transitions: 1, sessions: 1 },
      { site: 'shop', from_path: '/signup', to_path: '/pricing', transitions: 1, sessions: 1 },
    ]);
  });

  it('hitcount_entry_pages and hitcount_exit_pages: each session counted at its first and last page', async () => {
    expect(await select('select * from hitcount_entry_pages order by site, path')).toEqual([
      { site: 'blog', path: '/', sessions: 1 },
      { site: 'blog', path: '/post', sessions: 1 },
      { site: 'shop', path: '/', sessions: 2 },
      { site: 'shop', path: '/plans', sessions: 1 },
    ]);
    expect(await select('select * from hitcount_exit_pages order by site, path')).toEqual([
      { site: 'blog', path: '/post', sessions: 1 },
      { site: 'blog', path: '/pricing', sessions: 1 },
      { site: 'shop', path: '/docs', sessions: 2 },
      { site: 'shop', path: '/pricing', sessions: 1 },
    ]);
  });

  it('hitcount_path_funnel: sessions that viewed each path after the ones before, without the plugin', async () => {
    const pathFunnel = (args: string) => select(`select * from hitcount_path_funnel(${args})`);
    expect(await pathFunnel(`array['/', '/pricing', '/signup'], 'shop'`)).toEqual([
      { step: 1, path: '/', sessions: 2 },
      { step: 2, path: '/pricing', sessions: 1 },
      { step: 3, path: '/signup', sessions: 1 },
    ]);
    // Session 1 saw / only before /pricing.
    expect(await pathFunnel(`array['/pricing', '/'], 'shop'`)).toEqual([
      { step: 1, path: '/pricing', sessions: 1 },
      { step: 2, path: '/', sessions: 0 },
    ]);
    // Every site: sessions 1, 3 and 4 saw /; 1 and 4 then /pricing.
    expect(await pathFunnel(`array['/', '/pricing']`)).toEqual([
      { step: 1, path: '/', sessions: 3 },
      { step: 2, path: '/pricing', sessions: 2 },
    ]);
    // From 12:21: session 3's second / and session 4.
    expect(await pathFunnel(`array['/', '/pricing'], since => '2026-10-16T12:21:00Z'`)).toEqual([
      { step: 1, path: '/', sessions: 2 },
      { step: 2, path: '/pricing', sessions: 1 },
    ]);
  });

  it('hitcount_path_funnel takes paths as the funnels plugin does: * for any run, no trailing slash, nothing else special', async () => {
    expect(await select(`select * from hitcount_path_funnel(array['/sign*/', '/pricing'], 'shop')`)).toEqual([
      { step: 1, path: '/sign*/', sessions: 1 },
      { step: 2, path: '/pricing', sessions: 1 },
    ]);
    expect(await select(`select * from hitcount_path_funnel(array['/p_ans', '/pl%'], 'shop')`)).toEqual([
      { step: 1, path: '/p_ans', sessions: 0 },
      { step: 2, path: '/pl%', sessions: 0 },
    ]);
  });

  it('shows the public anon role nothing: it may insert events, never read them, here either', async () => {
    // Supabase grants anon select on everything in public; row-level security is what stops it reading.
    await db.exec('grant select on hitcount_events, hitcount_funnels, hitcount_flows, hitcount_entry_pages, hitcount_exit_pages to anon');
    await db.exec('set role anon');
    try {
      for (const view of ['hitcount_funnels', 'hitcount_flows', 'hitcount_entry_pages', 'hitcount_exit_pages']) {
        expect(await select(`select * from ${view}`), view).toEqual([]);
      }
      expect(await select(`select * from hitcount_path_funnel(array['/'])`)).toEqual([{ step: 1, path: '/', sessions: 0 }]);
    } finally {
      await db.exec('reset role');
    }
  });
});
