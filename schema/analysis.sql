-- Read-only analysis over hitcount_events (schema/postgres.sql): funnels, page flows, entry and exit pages.
-- Run it after postgres.sql; running it again replaces the views and the function.
--
-- The views are security_invoker (Postgres 15+). A view otherwise reads its table as the view's owner,
-- past row-level security, and Supabase lets the public anon key select from every view in public.

-- One row per site, funnel and step, from the funnels plugin's funnel_step events: the sessions that
-- reached the step, out of those that entered the funnel at any step, and drop_from_previous, the
-- sessions that reached the step before and never this one (null on step 1).
create or replace view hitcount_funnels with (security_invoker = true) as
-- The public key can insert anything, so a malformed step must neither break the view with a bad cast
-- nor run generate_series below to a huge step count. Postgres may reorder AND, so the casts wait in a
-- CASE, and materialized keeps the outer query's casts from being pushed down past it.
with steps as materialized (
  select site, props->>'funnel' as funnel, (props->>'step')::int as step, (props->>'steps')::int as steps,
         props->>'stepName' as step_name, session_id, time
  from hitcount_events
  where name = 'funnel_step'
    and props->>'funnel' is not null
    and case when props->>'step' ~ '^[0-9]{1,3}$' and props->>'steps' ~ '^[0-9]{1,3}$'
             then (props->>'step')::int between 1 and (props->>'steps')::int end
),
funnels as (
  select site, funnel, max(steps) as steps, count(distinct session_id) as entered
  from steps
  group by site, funnel
),
reached as (
  -- The name a step was last sent with, should the funnel have been redeclared since.
  select site, funnel, step, count(distinct session_id) as sessions,
         (array_agg(step_name order by time desc))[1] as step_name
  from steps
  group by site, funnel, step
),
stopped as (
  select site, funnel, step + 1 as next_step, count(distinct session_id) as sessions
  from steps earlier
  where not exists (
    select from steps later
    where later.site is not distinct from earlier.site and later.funnel = earlier.funnel
      and later.session_id = earlier.session_id and later.step = earlier.step + 1
  )
  group by site, funnel, step
)
-- Every step of the funnel gets a row, those no session reached included: steps comes with each event.
select f.site, f.funnel, n as step, r.step_name, coalesce(r.sessions, 0) as sessions, f.entered,
       round(100.0 * coalesce(r.sessions, 0) / f.entered, 1) as pct_of_entered,
       case when n > 1 then coalesce(s.sessions, 0) end as drop_from_previous
from funnels f
cross join generate_series(1, f.steps) as n
left join reached r on r.site is not distinct from f.site and r.funnel = f.funnel and r.step = n
left join stopped s on s.site is not distinct from f.site and s.funnel = f.funnel and s.next_step = n;

-- One row per site and pair of pages: how often a page view of from_path came right before one of
-- to_path in the same session, and in how many sessions. A reload counts, as a page to itself.
create or replace view hitcount_flows with (security_invoker = true) as
select site, from_path, to_path, count(*) as transitions, count(distinct session_id) as sessions
from (
  select site, session_id, path as from_path,
         lead(path) over (partition by site, session_id order by time, id) as to_path
  from hitcount_events
  where name = 'pageview'
) as views
where to_path is not null
group by site, from_path, to_path;

-- One row per site and path: the sessions whose first page view was of that path.
create or replace view hitcount_entry_pages with (security_invoker = true) as
select site, path, count(*) as sessions
from (
  select distinct on (site, session_id) site, path
  from hitcount_events
  where name = 'pageview'
  order by site, session_id, time, id
) as first_views
group by site, path;

-- One row per site and path: the sessions whose last page view was of that path.
create or replace view hitcount_exit_pages with (security_invoker = true) as
select site, path, count(*) as sessions
from (
  select distinct on (site, session_id) site, path
  from hitcount_events
  where name = 'pageview'
  order by site, session_id, time desc, id desc
) as last_views
group by site, path;

-- One row per step: the sessions that viewed steps[1], then later steps[2], and so on in order, from
-- page views alone, so it works without the funnels plugin. Paths match as the plugin's do: * is any
-- run of characters and a trailing slash is ignored. A null site means every site.
create or replace function hitcount_path_funnel(steps text[], site text default null, since timestamptz default '-infinity')
returns table (step int, path text, sessions bigint)
language sql stable
as $$
  with recursive patterns as (
    -- * becomes LIKE's %, after escaping the characters LIKE would otherwise treat as wildcards.
    select n::int as step, given.path,
           replace(replace(replace(replace(coalesce(nullif(rtrim(given.path, '/'), ''), '/'),
             '\', '\\'), '%', '\%'), '_', '\_'), '*', '%') as pattern
    from unnest(steps) with ordinality as given(path, n)
  ),
  views as (
    select e.session_id, coalesce(nullif(rtrim(e.path, '/'), ''), '/') as path, e.time, e.id
    from hitcount_events e
    where e.name = 'pageview' and e.time >= since
      and (hitcount_path_funnel.site is null or e.site = hitcount_path_funnel.site)
  ),
  reached as (
    -- Each session's earliest view of step 1, then its earliest view of each next step after that:
    -- the earliest is never worse for reaching the steps still to come.
    (select distinct on (v.session_id) v.session_id, 1 as step, v.time, v.id
     from views v
     join patterns p on p.step = 1 and v.path like p.pattern
     order by v.session_id, v.time, v.id)
    union all
    select r.session_id, r.step + 1, next_view.time, next_view.id
    from reached r
    join patterns p on p.step = r.step + 1
    cross join lateral (
      select v.time, v.id
      from views v
      where v.session_id = r.session_id and v.path like p.pattern and (v.time, v.id) > (r.time, r.id)
      order by v.time, v.id
      limit 1
    ) as next_view
  )
  select p.step, p.path, count(r.session_id)
  from patterns p
  left join reached r on r.step = p.step
  group by p.step, p.path
  order by p.step;
$$;
