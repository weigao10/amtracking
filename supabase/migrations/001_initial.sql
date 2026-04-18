-- ============================================================
-- Amtracking — initial schema
-- Run this in the Supabase SQL editor or via supabase db push
-- ============================================================

-- Enable uuid-ossp for gen_random_uuid() (available by default in Supabase)

-- ─── watches ─────────────────────────────────────────────────────────────────
-- One row per tracked route / date / class combination.

create table if not exists watches (
    id           uuid primary key default gen_random_uuid(),
    origin       text        not null,            -- station code, e.g. 'NYP'
    destination  text        not null,            -- station code, e.g. 'WAS'
    date         date        not null,            -- travel date
    class        text        not null             -- 'coach' | 'business' | 'sleeper'
                   check (class in ('coach', 'business', 'sleeper')),
    target_price numeric     not null,            -- alert when price falls below this
    active       boolean     not null default true,
    created_at   timestamptz not null default now()
);

comment on table  watches              is 'Routes being tracked for price changes.';
comment on column watches.origin       is 'Amtrak station code for the departure station.';
comment on column watches.destination  is 'Amtrak station code for the arrival station.';
comment on column watches.date         is 'Date of travel (not booking date).';
comment on column watches.class        is 'Fare class: coach, business, or sleeper.';
comment on column watches.target_price is 'Send a below_target alert when price drops below this value.';

create index if not exists watches_active_idx on watches (active);

-- ─── price_snapshots ─────────────────────────────────────────────────────────
-- One row per price check. Append-only; never update existing rows.

create table if not exists price_snapshots (
    id               uuid primary key default gen_random_uuid(),
    watch_id         uuid        not null references watches (id) on delete cascade,
    price            numeric     not null,
    seats_available  integer,                     -- null when the API does not expose seat counts
    checked_at       timestamptz not null default now()
);

comment on table  price_snapshots                  is 'Immutable log of every price check.';
comment on column price_snapshots.price            is 'Cheapest available fare in USD at time of check.';
comment on column price_snapshots.seats_available  is 'Remaining seats/rooms, null when unknown.';
comment on column price_snapshots.checked_at       is 'When this snapshot was captured (UTC).';

create index if not exists price_snapshots_watch_id_idx     on price_snapshots (watch_id);
create index if not exists price_snapshots_checked_at_idx   on price_snapshots (checked_at desc);
-- Composite index for the common query: latest snapshot for a watch
create index if not exists price_snapshots_watch_time_idx   on price_snapshots (watch_id, checked_at desc);
-- Composite index for historic-low query
create index if not exists price_snapshots_watch_price_idx  on price_snapshots (watch_id, price asc);

-- ─── alerts ──────────────────────────────────────────────────────────────────
-- Deduplication log — one row per alert sent.

create table if not exists alerts (
    id                   uuid primary key default gen_random_uuid(),
    watch_id             uuid        not null references watches (id) on delete cascade,
    alert_type           text        not null
                           check (alert_type in ('below_target', 'price_drop', 'near_historic_low')),
    price                numeric     not null,    -- price that triggered the alert
    historic_low_at_time numeric,                 -- only populated for near_historic_low alerts
    sent_at              timestamptz not null default now()
);

comment on table  alerts                        is 'Record of every alert notification sent (used for cooldown deduplication).';
comment on column alerts.alert_type             is 'below_target | price_drop | near_historic_low';
comment on column alerts.historic_low_at_time   is 'The all-time low price at the moment the near_historic_low alert fired.';
comment on column alerts.sent_at                is 'When the alert was delivered (UTC).';

-- Cooldown query: was an alert of this type sent for this watch recently?
create index if not exists alerts_watch_type_sent_idx on alerts (watch_id, alert_type, sent_at desc);

-- ─── Row-Level Security (optional — enable if using anon key from browser) ───
-- By default the checker uses the service-role key on the server, so RLS is
-- not strictly required. Uncomment and adapt if you expose this to the browser.

-- alter table watches         enable row level security;
-- alter table price_snapshots enable row level security;
-- alter table alerts          enable row level security;

-- -- Allow the anon role to read all rows (dashboard read-only access)
-- create policy "anon can read watches"
--     on watches for select using (true);

-- create policy "anon can read price_snapshots"
--     on price_snapshots for select using (true);

-- create policy "anon can read alerts"
--     on alerts for select using (true);
