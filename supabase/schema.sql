-- Qu'an — account & team foundation for Supabase.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- Basic email+password login works WITHOUT this; it's here so accounts can grow
-- into multi-user teams later without re-architecting.

-- 1. Per-user profile, 1:1 with auth.users -------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  created_at timestamptz not null default now()
);

-- auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Teams + membership --------------------------------------------------------
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- 3. Row-level security --------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

-- profiles: a user can read/update only their own row
drop policy if exists "profiles self read"  on public.profiles;
create policy "profiles self read"  on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles self write" on public.profiles;
create policy "profiles self write" on public.profiles for update using (auth.uid() = id);

-- team_members: a user can see their own memberships
drop policy if exists "memberships self" on public.team_members;
create policy "memberships self" on public.team_members for select using (auth.uid() = user_id);

-- teams: a user can see teams they belong to
drop policy if exists "teams by membership" on public.teams;
create policy "teams by membership" on public.teams for select
  using (exists (select 1 from public.team_members m where m.team_id = teams.id and m.user_id = auth.uid()));

-- owners can update / delete their teams
drop policy if exists "teams owner manage" on public.teams;
create policy "teams owner manage" on public.teams for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- 4. Stripe subscriptions ------------------------------------------------------
-- One row per user, mirroring their Stripe subscription. Written ONLY by the
-- server (Cloudflare Pages Function /api/webhook) using the service-role key,
-- which bypasses RLS. The app reads state through /api/subscription (also
-- service-role), but we still enable RLS + a self-read policy so the anon key
-- can never read someone else's billing row directly.
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid unique references auth.users(id) on delete cascade,
  email                  text,
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  status                 text not null default 'none',   -- trialing|active|past_due|canceled|incomplete|none
  plan                   text,                            -- 'operator' | 'desk'
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;

-- a user may read only their own subscription row; nobody may write via the
-- anon/authenticated keys (all writes go through the service role).
drop policy if exists "subscriptions self read" on public.subscriptions;
create policy "subscriptions self read" on public.subscriptions
  for select using (auth.uid() = user_id);

-- 5. Roaming user state (Phase 2 — stateful workspaces) ------------------------
-- Per-user key/value store that mirrors the terminal's client-side state so a
-- workspace (uploaded chains, greeks warehouse, compass state, layout, theme,
-- selected instrument/date) follows the user across devices.
--
-- Written/read by the app through /api/state using the USER's own token, so RLS
-- (auth.uid() = user_id) is the isolation — no service role involved. Small
-- values live inline in `value`; large ones (option-chain CSVs) go to R2 and
-- `in_r2` is set, with `value` left null. `updated_at` drives last-write-wins
-- across devices.
create table if not exists public.user_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  value      text,                              -- inline value (small); null when in_r2
  in_r2      boolean not null default false,    -- true => body is in the QUAN_STATE R2 bucket
  size       integer not null default 0,        -- byte length of the value
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_state enable row level security;

-- a user may fully manage only their own state rows
drop policy if exists "user_state self" on public.user_state;
create policy "user_state self" on public.user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 6. Brief history / archive (Phase 3 — snapshots over time) -------------------
-- One durable row per user/instrument/trading-date, capturing the computed
-- Report (and optionally the Heat Map grid) so past field reads can be browsed
-- and re-published. Written/read via /api/archive with the user's own token
-- (RLS-enforced). Listing columns (classification, summary) are inline for cheap
-- lists; the full snapshot payload lives in the QUAN_STATE R2 bucket under
-- brief/<user_id>/<inst>/<date>.json, or inline in `payload` when R2 isn't bound.
create table if not exists public.brief_history (
  user_id        uuid not null references auth.users(id) on delete cascade,
  inst           text not null,
  date           text not null,                 -- trading date the brief is for (YYYY-MM-DD)
  classification text,                           -- e.g. field type — shown in the list
  summary        text,                           -- short sub-line
  in_r2          boolean not null default false, -- true => payload is in R2, `payload` is null
  payload        text,                           -- inline {report,heatmap} JSON when not in R2
  has_heatmap    boolean not null default false,
  updated_at     timestamptz not null default now(),
  primary key (user_id, inst, date)
);

create index if not exists brief_history_user_date_idx on public.brief_history (user_id, date desc);

alter table public.brief_history enable row level security;

drop policy if exists "brief_history self" on public.brief_history;
create policy "brief_history self" on public.brief_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
