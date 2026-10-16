import type { Sink } from '../types';
import { http } from './http';
import { toRow } from './row';

export interface SupabaseSinkOptions {
  /** Project URL, e.g. https://abcd.supabase.co */
  url: string;
  /** Anon or publishable key. Pair it with the insert-only policy in schema/postgres.sql. */
  key: string;
  table?: string;
}

/** Inserts events straight into a Postgres table through Supabase's REST API. No server needed. */
export function supabase({ url, key, table = 'analy_events' }: SupabaseSinkOptions): Sink {
  // Legacy anon keys are JWTs and go in Authorization too; publishable keys (sb_publishable_…) only in apikey.
  const auth: Record<string, string> = key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {};
  const sink = http(`${url.replace(/\/$/, '')}/rest/v1/${table}`, {
    headers: { apikey: key, ...auth, prefer: 'return=minimal' },
    format: (events) => events.map(toRow),
  });
  return { ...sink, name: 'supabase' };
}
