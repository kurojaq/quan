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
