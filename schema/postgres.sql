-- analy events table. Column names match toRow() in src/sinks/row.ts (a test keeps them in sync).
-- Works on any Postgres; the row-level security at the bottom is for Supabase.

create table if not exists analy_events (
  id               uuid        primary key,
  name             text        not null,
  time             timestamptz not null,           -- visitor's clock; received_at is the server's
  site             text,                           -- null when no site was configured
  visitor_id       uuid,                           -- null unless persist is 'local' or 'cookie'
  session_id       uuid        not null,
  user_id          text,                           -- null until identify()
  page_view_id     uuid        not null,
  url              text        not null,
  path             text        not null,
  title            text        not null,
  referrer         text,                           -- null for direct visits
  language         text        not null,
  timezone         text        not null,
  screen           text        not null,
  viewport         text        not null,
  touch            boolean     not null,
  user_agent       text        not null,
  browser          text,                           -- browser … color_scheme: null without the device plugin
  browser_version  text,
  os               text,
  device_type      text check (device_type in ('mobile', 'tablet', 'desktop')),
  connection       text,                           -- also null outside Chromium
  color_scheme     text check (color_scheme in ('light', 'dark')),
  utm_source       text,                           -- utm_*: null when the URL had no such param
  utm_medium       text,
  utm_campaign     text,
  utm_term         text,
  utm_content      text,
  source_channel   text check (source_channel in ('direct', 'internal', 'search', 'social', 'ai', 'email', 'paid', 'referral')),
                                                   -- source_*: page views only, with the channels plugin
  source_name      text,
  traffic_kind     text check (traffic_kind in ('unknown', 'human', 'automated', 'ai-agent', 'crawler')),
                                                   -- traffic_*: null without the traffic plugin
  traffic_signals  text[],
  props            jsonb       not null default '{}',
  received_at      timestamptz not null default now()
);

create index if not exists analy_events_site_time on analy_events (site, time desc);
create index if not exists analy_events_session on analy_events (session_id);
create index if not exists analy_events_name_time on analy_events (name, time desc);

-- Supabase: the public key may insert events, never read, change or delete them.
alter table analy_events enable row level security;
create policy "analy: public insert" on analy_events for insert to anon with check (true);
